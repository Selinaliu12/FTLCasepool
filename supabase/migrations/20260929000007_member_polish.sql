-- Task 8（Task 7 review minor 1，controller ruling：折進 Task 8）。
--
-- set_pm_groups()：原本的 left_at 檢查（20260929000006_member_remove.sql）只是先
-- `select ... into v_left_at from members where id = p_pm_member_id`，沒有鎖也沒有
-- `for update`——跟 admin_remove_identity()／admin_remove_person() 之間有競速窗口：
-- 一個管理員正在把這個專案幹部標成已離開（走的是 'member:<semester>:<email>' 這把
-- advisory lock），另一個管理員同時呼叫 set_pm_groups() 指派組別，如果 set_pm_groups()
-- 讀 left_at 的那一刻剛好在移除交易 commit 之前，會讀到「還沒離開」，插入
-- pm_assignments 之後移除交易才 commit——結果是一個已離開的專案幹部還留著負責組別的指派。
--
-- 修法：跟 admin_remove_identity() 一樣，先讀出這個人的信箱，用同一把
-- 'member:<semester>:<email>' advisory lock 排隊（跟所有會動這個信箱的 members 寫入
-- 動作——新增、編輯、移除——共用同一個 lock namespace，見 20260929000005_member_lock.sql
-- 的 F2 裁決），拿到鎖之後用 `for update` 重新讀一次這一列再判斷 left_at。這樣
-- set_pm_groups() 跟「移除這個人」之間就會真的排隊，不會出現指派完成後才發現這個人已經
-- 離開的狀態。
create or replace function set_pm_groups(p_pm_member_id uuid, p_group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row members%rowtype;
  v_bad_count int;
begin
  select * into v_row from members where id = p_pm_member_id;
  if not found then
    raise exception '只有專案幹部才能負責組別';
  end if;

  perform pg_advisory_xact_lock(hashtext('member:' || v_row.semester_id::text || ':' || v_row.email));

  -- 拿到鎖之後重讀一次：鎖之前讀到的那份 snapshot 在等鎖的期間可能已經被移除動作改掉。
  select * into v_row from members where id = p_pm_member_id for update;

  if v_row.role is distinct from 'pm' then
    raise exception '只有專案幹部才能負責組別';
  end if;
  if v_row.left_at is not null then
    raise exception '這位專案幹部已離開';
  end if;

  select count(*) into v_bad_count
  from unnest(p_group_ids) as gid
  where not exists (select 1 from groups g where g.id = gid and g.semester_id = v_row.semester_id);

  if v_bad_count > 0 then
    raise exception '組別不屬於本學期';
  end if;

  delete from pm_assignments where pm_member_id = p_pm_member_id;

  if p_group_ids is not null and array_length(p_group_ids, 1) is not null then
    insert into pm_assignments (pm_member_id, group_id)
    select p_pm_member_id, gid from unnest(p_group_ids) as gid;
  end if;
end;
$$;
revoke all on function set_pm_groups(uuid, uuid[]) from public, anon, authenticated;
grant execute on function set_pm_groups(uuid, uuid[]) to service_role;
