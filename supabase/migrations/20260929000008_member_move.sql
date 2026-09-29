-- 最終審查修正（final-review.md I1、M1）。
--
-- (1) admin_move_member()：換組原本在 TypeScript 用好幾次 PostgREST 呼叫完成（查成員、查目標組、
--     查重複身份、查已離開的列、恢復目標列、把原本那列標已離開），沒有拿成員寫入共用的
--     'member:<semester>:<email>' advisory lock，恢復路徑的兩次 UPDATE 也不在同一個交易裡：
--       - 兩次 UPDATE 之間失敗 → 同一個人在舊組、目標組都「還在」；
--       - 跟 admin_remove_person() 交錯 → 「整個人已移除」之後，目標組那列又被恢復。
--     改成一個 service_role 專用的 SECURITY DEFINER 函式，在同一個交易裡：拿同一把鎖（信箱在等鎖
--     期間被改掉就換鎖重來，跟 admin_remove_identity() 一樣）、for update 重讀、檢查、寫入。
--     規則跟原本的 moveMember() 一樣：
--       - 只有專案生可以換組；已離開的身份不能換組；
--       - 目標組必須跟這個身份同一個學期，而且是本學期；
--       - 這個人在目標組已經有「還在」的專案生身份 → 這位同學已經在{組名}了；
--       - 目標組有這個人「已離開」的那一列 → 恢復那一列（姓名／學號／系級同步成被搬動那列的值），
--         被搬動的那一列改標已離開；否則直接改 group_id。
--
-- (2) set_pm_groups()：先讀信箱、再拿鎖、再 for update 重讀——等鎖期間信箱可能被
--     admin_edit_person() 改掉，這時候拿到的是舊信箱的鎖，跟新信箱的寫入（例如移除這個人）
--     並沒有排隊。改成跟 admin_remove_identity() 一樣的迴圈：重讀後信箱變了就換鎖重來。
--     跟 admin_remove_identity() 不同的一點：迴圈裡的重讀不加 for update，拿到正確信箱的鎖之後
--     才 for update。迴圈裡握著列鎖去等新信箱的鎖，會跟「拿著新信箱的鎖、要改這一列」的交易
--     deadlock（整合測試實際重現過）。
--
-- (3) admin_remove_person()：先把身份標成已離開、再刪專案幹部的負責組別（原本順序相反）。
--     先 UPDATE 會先拿到這些列的列鎖，任何還沒排到 advisory lock、但會 for update 讀這一列的寫入
--     都要等這個交易結束，看到的一定是「已離開」，不會在「負責組別已刪、人還沒標離開」的空檔插入
--     新的指派。

-- ---- (1) 換組 ----
create or replace function admin_move_member(p_member_id uuid, p_to_group_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row members%rowtype;
  v_locked_email text;
  v_group groups%rowtype;
  v_left_id uuid;
begin
  loop
    select * into v_row from members where id = p_member_id;
    if not found then
      raise exception '找不到這個身份';
    end if;
    v_locked_email := v_row.email;
    perform pg_advisory_xact_lock(hashtext('member:' || v_row.semester_id::text || ':' || v_locked_email));
    -- 重讀時先不拿列鎖：信箱變了要去等另一把 advisory lock，這時候如果手上還握著這一列的列鎖，
    -- 會跟「拿著新信箱的鎖、正要改這一列」的交易互等（deadlock）。
    select * into v_row from members where id = p_member_id;
    exit when v_row.email = v_locked_email;
  end loop;
  -- 已經拿到這個信箱的鎖（改信箱也要拿舊信箱的鎖），信箱不會再變；這時候才拿列鎖。
  select * into v_row from members where id = p_member_id for update;

  if v_row.role <> 'student' then
    raise exception '只有專案生可以換組';
  end if;
  if v_row.left_at is not null then
    raise exception '這個身份已離開';
  end if;

  select * into v_group from groups where id = p_to_group_id;
  if not found or v_group.semester_id <> v_row.semester_id then
    raise exception '目標組別必須在同一個學期';
  end if;
  if not exists (select 1 from semesters where id = v_row.semester_id and is_current) then
    raise exception '只能在本學期換組';
  end if;

  -- 已經在這一組：什麼都不做。
  if v_row.group_id = p_to_group_id then
    return;
  end if;

  if exists (
    select 1 from members
    where semester_id = v_row.semester_id and email = v_row.email and role = 'student'
      and group_id = p_to_group_id and left_at is null and id <> p_member_id
  ) then
    raise exception '這位同學已經在%了', v_group.name;
  end if;

  select id into v_left_id from members
  where semester_id = v_row.semester_id and email = v_row.email and role = 'student'
    and group_id = p_to_group_id and left_at is not null and id <> p_member_id
  for update;

  if v_left_id is not null then
    update members
      set left_at = null, name = v_row.name, student_id = v_row.student_id, dept_year = v_row.dept_year
      where id = v_left_id;
    update members set left_at = now() where id = p_member_id;
  else
    update members set group_id = p_to_group_id where id = p_member_id;
  end if;
exception
  when unique_violation then
    raise exception '這位同學已經在%了', v_group.name;
end;
$$;

revoke all on function admin_move_member(uuid, uuid) from public, anon, authenticated;
grant execute on function admin_move_member(uuid, uuid) to service_role;

-- ---- (2) set_pm_groups()：信箱在等鎖期間變了就換鎖重來 ----
create or replace function set_pm_groups(p_pm_member_id uuid, p_group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row members%rowtype;
  v_locked_email text;
  v_bad_count int;
begin
  loop
    select * into v_row from members where id = p_pm_member_id;
    if not found then
      raise exception '只有專案幹部才能負責組別';
    end if;
    v_locked_email := v_row.email;
    perform pg_advisory_xact_lock(hashtext('member:' || v_row.semester_id::text || ':' || v_locked_email));
    -- 拿到鎖之後重讀一次：等鎖期間這一列可能被移除，或信箱被改掉（那就要換新信箱的鎖）。
    -- 這裡先不拿列鎖，理由同 admin_move_member()：避免握著列鎖去等新信箱的鎖而 deadlock。
    select * into v_row from members where id = p_pm_member_id;
    exit when v_row.email = v_locked_email;
  end loop;
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

-- ---- (3) admin_remove_person()：先標已離開，再刪負責組別 ----
create or replace function admin_remove_person(p_semester_id uuid, p_email text) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  if not exists (select 1 from semesters where id = p_semester_id and is_current) then
    raise exception '只能移除本學期的成員';
  end if;

  perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_email));

  if not exists (select 1 from members where semester_id = p_semester_id and email = v_email) then
    raise exception '找不到這個人';
  end if;

  -- 已經離開的身份保留原本的離開時間（no-op）。
  update members set left_at = now()
  where semester_id = p_semester_id and email = v_email and left_at is null;

  delete from pm_assignments
  where pm_member_id in (
    select id from members where semester_id = p_semester_id and email = v_email and role = 'pm'
  );
end;
$$;

revoke all on function admin_remove_person(uuid, text) from public, anon, authenticated;
grant execute on function admin_remove_person(uuid, text) to service_role;
