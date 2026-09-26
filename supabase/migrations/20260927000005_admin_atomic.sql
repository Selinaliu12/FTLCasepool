-- Task 5 fix round 1：把「先讀/檢查、再分開寫兩次」的管理員動作改成單一交易的 SQL 函式。
--
-- 原本 createSemester／savePeriods／setPmGroups 都是「TS 端做兩次分開的 db.from(...) 呼叫」，
-- 中間有時間窗：
--   - createSemester：先 update 把舊學期設成非當前，再 insert 新學期；如果 insert 撞到
--     semesters.name 的 unique 限制失敗，前一步的 update 已經送出去了，變成沒有任何學期是
--     current，整個系統被鎖死（一直進 no_semester 狀態）。
--   - savePeriods：先查有沒有 progress_reports 參照現有 periods，通過了才刪除＋重建；
--     在「查完」跟「刪除」中間，如果剛好有人送出這一期的進度，會被緊接著的 delete cascade
--     刪掉，而檢查當下看起來是安全的。
--   - setPmGroups：先刪除舊的 pm_assignments 再整批插入新的；如果插入中途失敗（例如某個
--     group_id 其實是別的學期的），會留下「舊的已經刪了、新的沒插完」的髒狀態。
--
-- 統一做法：每個動作各包成一個 plpgsql 函式，整個函式只呼叫一次（一個 RPC = 一個 statement），
-- Postgres 本身就會把函式裡所有的讀寫包在同一個交易裡——函式中途丟例外，函式做的所有事情
-- （包含前面成功的 update／delete）都會整個回滾，不需要額外寫 SAVEPOINT。
-- 跟 import_roster() 一樣，只 grant 給 service_role，其他角色一律收回權限。

create or replace function create_semester(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update semesters set is_current = false where is_current;
  insert into semesters (name, is_current) values (p_name, true) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function create_semester(text) from public, anon, authenticated;
grant execute on function create_semester(text) to service_role;

create or replace function save_periods(p_semester_id uuid, p_deadlines timestamptz[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from progress_reports pr
    join periods p on p.id = pr.period_id
    where p.semester_id = p_semester_id
  ) then
    raise exception '已經有組別交了進度，不能再改期別';
  end if;

  delete from periods where semester_id = p_semester_id;

  insert into periods (semester_id, seq, deadline)
  select p_semester_id, ord, d
  from unnest(p_deadlines) with ordinality as t(d, ord);
end;
$$;

revoke all on function save_periods(uuid, timestamptz[]) from public, anon, authenticated;
grant execute on function save_periods(uuid, timestamptz[]) to service_role;

create or replace function set_pm_groups(p_pm_member_id uuid, p_group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role role;
  v_semester_id uuid;
  v_bad_count int;
begin
  select role, semester_id into v_role, v_semester_id from members where id = p_pm_member_id;

  if v_role is distinct from 'pm' then
    raise exception '只有專案幹部才能負責組別';
  end if;

  select count(*) into v_bad_count
  from unnest(p_group_ids) as gid
  where not exists (select 1 from groups g where g.id = gid and g.semester_id = v_semester_id);

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
