-- Batch 2 final whole-branch review fixes (IMPORTANT 1a).
--
-- 已經有組別掛了（未退出）的比賽不能取消發布：草稿會被 read_competitions 的 RLS 擋掉，學生那邊
-- 的報名頁、比賽線、階段下載全部讀不到比賽資料。這個檢查要是原子的，所以兩邊各鎖一次同一列
-- competitions：
--
--   1) unpublish_competition()：FOR UPDATE 鎖住比賽那一列，再看有沒有未退出的報名，沒有才改成
--      draft。
--   2) competition_entries 的 BEFORE INSERT trigger：新增一筆未退出的報名時，FOR SHARE 鎖住比賽
--      那一列，再看一次 status 是不是 published——擋掉「attachCompetition 讀到 published 之後、
--      insert 之前，比賽剛好被取消發布」這個時間窗。
--
-- FOR UPDATE 跟 FOR SHARE 互斥：誰先拿到鎖誰先做完；後來的那一方在 READ COMMITTED 底下拿到鎖
-- 之後重新讀，看得到先做完的那一方已經 commit 的結果（取消發布先 → insert 看到 draft 被擋；
-- insert 先 → 取消發布看到那筆未退出的報名被擋），不會出現「草稿＋未退出報名」。

create function unpublish_competition(p_competition_id uuid, p_semester_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from competitions
  where id = p_competition_id and semester_id = p_semester_id
  for update;

  if v_id is null then
    raise exception 'competition_not_found';
  end if;

  if exists (
    select 1 from competition_entries
    where competition_id = p_competition_id and withdrawn_at is null
  ) then
    raise exception 'has_entries';
  end if;

  update competitions set status = 'draft', updated_at = now() where id = p_competition_id;
end;
$$;

revoke all on function unpublish_competition(uuid, uuid) from public, anon, authenticated;
grant execute on function unpublish_competition(uuid, uuid) to service_role;

create function reject_entry_on_unpublished_competition() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.withdrawn_at is not null then
    return new;
  end if;

  select status into v_status from competitions where id = new.competition_id for share;

  if v_status is distinct from 'published' then
    raise exception 'competition_not_published';
  end if;

  return new;
end;
$$;

revoke all on function reject_entry_on_unpublished_competition() from public, anon, authenticated;

create trigger competition_entries_require_published before insert on competition_entries
  for each row execute function reject_entry_on_unpublished_competition();
