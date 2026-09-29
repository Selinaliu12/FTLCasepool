-- Task 7（規格 §16 第 5、6 點）：管理員移除某個身份或整個人＝軟移除（members.left_at = now()），
-- 不刪列：已交的進度、比賽紀錄都用信箱／member id 指回這一列，名字照常顯示（標「（已離開）」）。
-- 已離開的身份不能再登入使用：my_members()／getAccess() 在 Task 5 已經排除 left_at 不是 null 的列。
--
-- 這份 migration 也把 Task 5／6 review 留下來、controller 裁定併進 Task 7 的修正一起做完
-- （原本的函式定義在已經套用過的 migration 裡，不能改，這裡 create or replace 覆蓋）：
--   (b) admin_add_member()：先查「已經有這個身份（且沒離開）」，再查姓名／學號／系級一致性——
--       同一個身份重複新增時，管理員看到的是「這個人已經有這個身份」，不是一致性錯誤。
--   (c) admin_add_member()：函式自己正規化信箱（lower＋btrim）並檢查學校網域，不信任呼叫端。
--   (d) 恢復（或替這個人新增身份）之後，同一信箱本學期「所有」列的姓名／學號／系級一起更新成這次
--       填的值（以人為單位，跟 admin_edit_person() 一致），已離開的其他身份留下的紀錄也顯示同一個名字。
--   (e) member_has_records()：upload_tickets 用 key 字首判斷學期，原本 `key like (學期名稱 || '/%')`
--       在學期名稱含 % 或 _ 時會多比到別的 key；改成字面比較
--       `left(key, char_length(v_name) + 1) = v_name || '/'`。
-- 另外：
--   - confirm_entry()／update_entry_members()：已離開的成員不能被勾成參賽成員。
--   - review_stage()：已離開的專案幹部不算負責審核的人（就算殘留指派）。
--   - set_pm_groups()：已離開的專案幹部不能再被指派組別。
--   - 清掉既有「已離開的專案幹部」殘留的負責組別（Task 5 之後直接改 left_at 的資料）。

-- ---- 移除一個身份 ----
-- 同一個學期＋信箱用跟新增／編輯同一把 advisory lock（'member:<semester>:<email>'）排隊。先讀出
-- 信箱才能決定鎖哪一把，讀到之後、拿到鎖之前這一列的信箱可能被改掉（admin_edit_person），所以
-- 拿到鎖之後重讀一次（for update），信箱變了就換鎖重來。
create or replace function admin_remove_identity(p_member_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row members%rowtype;
  v_locked_email text;
begin
  loop
    select * into v_row from members where id = p_member_id;
    if not found then
      raise exception '找不到這個身份';
    end if;
    if not exists (select 1 from semesters where id = v_row.semester_id and is_current) then
      raise exception '只能移除本學期的成員';
    end if;
    v_locked_email := v_row.email;
    perform pg_advisory_xact_lock(hashtext('member:' || v_row.semester_id::text || ':' || v_locked_email));
    select * into v_row from members where id = p_member_id for update;
    exit when v_row.email = v_locked_email;
  end loop;

  -- 已經離開：什麼都不做，當成功（重複按、兩個管理員同時按）。
  if v_row.left_at is not null then
    return;
  end if;

  update members set left_at = now() where id = p_member_id;

  -- 專案幹部身份離開 → 一併移除他負責的組別（Global Constraints）。
  if v_row.role = 'pm' then
    delete from pm_assignments where pm_member_id = p_member_id;
  end if;
end;
$$;

revoke all on function admin_remove_identity(uuid) from public, anon, authenticated;
grant execute on function admin_remove_identity(uuid) to service_role;

-- ---- 移除整個人（這個信箱在本學期的所有身份）----
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

  delete from pm_assignments
  where pm_member_id in (
    select id from members where semester_id = p_semester_id and email = v_email and role = 'pm'
  );

  -- 已經離開的身份保留原本的離開時間（no-op）。
  update members set left_at = now()
  where semester_id = p_semester_id and email = v_email and left_at is null;
end;
$$;

revoke all on function admin_remove_person(uuid, text) from public, anon, authenticated;
grant execute on function admin_remove_person(uuid, text) to service_role;

-- ---- admin_add_member()：(b)(c)(d) ----
create or replace function admin_add_member(
  p_semester_id uuid,
  p_email text,
  p_name text,
  p_role role,
  p_student_id text,
  p_dept_year text,
  p_group_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_existing members%rowtype;
  v_id uuid;
  v_restored boolean := false;
begin
  if not exists (select 1 from semesters where id = p_semester_id and is_current) then
    raise exception '只能在本學期新增成員';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@g\.nccu\.edu\.tw$' then
    raise exception 'email 必須是 @g.nccu.edu.tw';
  end if;
  if (p_role = 'student') <> (p_group_id is not null) then
    raise exception '%', case when p_role = 'student' then '專案生要選組別' else '幹部不能填組別' end;
  end if;
  if p_group_id is not null
     and not exists (select 1 from groups where id = p_group_id and semester_id = p_semester_id) then
    raise exception '組別不屬於本學期';
  end if;

  perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_email));

  -- (b) 先看這個身份是不是已經在了。
  select * into v_existing from members
  where semester_id = p_semester_id and email = v_email and role = p_role
    and coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if v_existing.id is not null and v_existing.left_at is null then
    raise exception '這個人已經有這個身份';
  end if;

  -- 一致性只跟這個人「還在」的身份比（已離開的列可能是舊資料）。
  if exists (
    select 1 from members
    where semester_id = p_semester_id and email = v_email and left_at is null
      and (name is distinct from p_name
           or student_id is distinct from p_student_id
           or dept_year is distinct from p_dept_year)
  ) then
    raise exception '同一個信箱的姓名／學號／系級要一致';
  end if;

  if v_existing.id is not null then
    update members set left_at = null where id = v_existing.id;
    v_id := v_existing.id;
    v_restored := true;
  else
    insert into members (semester_id, email, name, role, student_id, dept_year, group_id)
    values (p_semester_id, v_email, p_name, p_role, p_student_id, p_dept_year, p_group_id)
    returning id into v_id;
  end if;

  -- (d) 以人為單位：這個信箱本學期所有列（含已離開的其他身份）的姓名／學號／系級一起更新。
  update members
    set name = p_name, student_id = p_student_id, dept_year = p_dept_year
    where semester_id = p_semester_id and email = v_email
      and (name is distinct from p_name
           or student_id is distinct from p_student_id
           or dept_year is distinct from p_dept_year);

  return jsonb_build_object('id', v_id, 'restored', v_restored);
exception
  when unique_violation then
    raise exception '這個人已經有這個身份';
end;
$$;

revoke all on function admin_add_member(uuid, text, text, role, text, text, uuid) from public, anon, authenticated;
grant execute on function admin_add_member(uuid, text, text, role, text, text, uuid) to service_role;

-- ---- member_has_records()：(e) 學期字首改成字面比較 ----
create or replace function member_has_records(p_semester_id uuid, p_email text) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_semester_name text;
  v_has_record boolean;
begin
  select name into v_semester_name from semesters where id = p_semester_id;

  select
    exists (
      select 1 from progress_reports pr
      join lines l on l.id = pr.line_id
      join groups g on g.id = l.group_id
      where g.semester_id = p_semester_id
        and (pr.submitted_by = p_email or pr.pdf_uploaded_by = p_email)
    )
    or exists (
      select 1 from checkins c
      join lines l on l.id = c.line_id
      join groups g on g.id = l.group_id
      where g.semester_id = p_semester_id and c.created_by = p_email
    )
    or (
      v_semester_name is not null
      and exists (
        select 1 from upload_tickets
        where issuer_email = p_email
          and left(key, char_length(v_semester_name) + 1) = v_semester_name || '/'
      )
    )
    or exists (
      select 1 from stage_submissions ss
      join lines l on l.id = ss.line_id
      join groups g on g.id = l.group_id
      where g.semester_id = p_semester_id
        and (ss.submitted_by = p_email or ss.pdf_uploaded_by = p_email or ss.reviewed_by = p_email)
    )
    or exists (
      select 1 from competition_entries ce
      join groups g on g.id = ce.group_id
      where g.semester_id = p_semester_id and ce.created_by = p_email
    )
    or exists (
      select 1 from competitions where semester_id = p_semester_id and created_by = p_email
    )
  into v_has_record;

  return v_has_record;
end;
$$;

revoke all on function member_has_records(uuid, text) from public, anon, authenticated;
grant execute on function member_has_records(uuid, text) to service_role;

-- ---- confirm_entry()：已離開的成員不能勾（其餘同 20260927000013）----
create or replace function confirm_entry(p_entry_id uuid, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_confirmed_at timestamptz;
  v_withdrawn_at timestamptz;
  v_distinct_ids uuid[];
  v_valid_count int;
  v_line_id uuid;
begin
  select group_id, confirmed_at, withdrawn_at into v_group_id, v_confirmed_at, v_withdrawn_at
  from competition_entries where id = p_entry_id
  for update;

  if v_group_id is null then
    raise exception '找不到這筆報名';
  end if;
  if v_confirmed_at is not null then
    raise exception '這筆報名已經確認過了';
  end if;
  if v_withdrawn_at is not null then
    raise exception '這筆報名已經退出';
  end if;

  select array_agg(distinct m) into v_distinct_ids from unnest(p_member_ids) as m;
  if v_distinct_ids is null or array_length(v_distinct_ids, 1) = 0 then
    raise exception '請至少勾選一位參賽成員';
  end if;

  select count(*) into v_valid_count
  from members
  where id = any(v_distinct_ids) and role = 'student' and group_id = v_group_id and left_at is null;

  if v_valid_count <> array_length(v_distinct_ids, 1) then
    raise exception '只能勾選自己組的專案生';
  end if;

  delete from entry_members where entry_id = p_entry_id;
  insert into entry_members (entry_id, member_id)
  select p_entry_id, m from unnest(v_distinct_ids) as m;

  update competition_entries set confirmed_at = now() where id = p_entry_id;

  insert into lines (group_id, kind, entry_id)
  values (v_group_id, 'competition', p_entry_id)
  returning id into v_line_id;

  return v_line_id;
end;
$$;

revoke all on function confirm_entry(uuid, uuid[]) from public, anon, authenticated;
grant execute on function confirm_entry(uuid, uuid[]) to service_role;

-- ---- update_entry_members()：已離開的成員不能勾（其餘同 20260927000013）----
create or replace function update_entry_members(p_entry_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_withdrawn_at timestamptz;
  v_distinct_ids uuid[];
  v_valid_count int;
begin
  select group_id, withdrawn_at into v_group_id, v_withdrawn_at
  from competition_entries where id = p_entry_id
  for update;

  if v_group_id is null then
    raise exception '找不到這筆報名';
  end if;
  if v_withdrawn_at is not null then
    raise exception '這筆報名已經退出';
  end if;

  select array_agg(distinct m) into v_distinct_ids from unnest(p_member_ids) as m;
  if v_distinct_ids is null or array_length(v_distinct_ids, 1) = 0 then
    raise exception '請至少勾選一位參賽成員';
  end if;

  select count(*) into v_valid_count
  from members
  where id = any(v_distinct_ids) and role = 'student' and group_id = v_group_id and left_at is null;

  if v_valid_count <> array_length(v_distinct_ids, 1) then
    raise exception '只能勾選自己組的專案生';
  end if;

  delete from entry_members where entry_id = p_entry_id;
  insert into entry_members (entry_id, member_id)
  select p_entry_id, m from unnest(v_distinct_ids) as m;
end;
$$;

revoke all on function update_entry_members(uuid, uuid[]) from public, anon, authenticated;
grant execute on function update_entry_members(uuid, uuid[]) to service_role;

-- ---- set_pm_groups()：已離開的專案幹部不能再被指派（其餘同 20260927000005）----
create or replace function set_pm_groups(p_pm_member_id uuid, p_group_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role role;
  v_semester_id uuid;
  v_left_at timestamptz;
  v_bad_count int;
begin
  select role, semester_id, left_at into v_role, v_semester_id, v_left_at from members where id = p_pm_member_id;

  if v_role is distinct from 'pm' then
    raise exception '只有專案幹部才能負責組別';
  end if;
  if v_left_at is not null then
    raise exception '這位專案幹部已離開';
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

-- ---- review_stage()：已離開的專案幹部不算負責審核的人（其餘同 20260927000018）----
create or replace function review_stage(
  p_submission_id uuid,
  p_reviewer text,
  p_pm_member_id uuid,
  p_decision text,
  p_comment text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid;
  v_group_id uuid;
  v_stage text;
  v_version int;
  v_review_status text;
  v_max_version int;
  v_withdrawn_at timestamptz;
  v_result text;
  v_comment text;
begin
  if p_decision not in ('approved', 'returned') then
    raise exception 'invalid_decision';
  end if;

  select line_id, stage, version, review_status
    into v_line_id, v_stage, v_version, v_review_status
  from stage_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'submission_not_found';
  end if;

  select group_id into v_group_id from lines where id = v_line_id;

  if not exists (
    select 1 from pm_assignments pa
    join members m on m.id = pa.pm_member_id
    where pa.pm_member_id = p_pm_member_id and pa.group_id = v_group_id and m.left_at is null
    for share of pa
  ) then
    raise exception 'not_assigned';
  end if;

  select max(version) into v_max_version
  from stage_submissions
  where line_id = v_line_id and stage = v_stage;

  if v_version <> v_max_version then
    raise exception 'not_latest';
  end if;

  if v_review_status <> 'pending' then
    raise exception 'already_reviewed';
  end if;

  select ce.withdrawn_at, ce.result into v_withdrawn_at, v_result
  from lines l join competition_entries ce on ce.id = l.entry_id
  where l.id = v_line_id;

  if v_withdrawn_at is not null or v_result in ('awarded', 'not_selected') then
    raise exception 'ended';
  end if;

  v_comment := nullif(trim(both from coalesce(p_comment, '')), '');

  if p_decision = 'returned' and v_comment is null then
    raise exception 'comment_required';
  end if;

  update stage_submissions
  set review_status = p_decision,
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      comment = v_comment
  where id = p_submission_id;
end;
$$;

revoke all on function review_stage(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function review_stage(uuid, text, uuid, text, text) to service_role;

-- ---- 既有資料：已離開的專案幹部殘留的負責組別 ----
delete from pm_assignments
where pm_member_id in (select id from members where left_at is not null);
