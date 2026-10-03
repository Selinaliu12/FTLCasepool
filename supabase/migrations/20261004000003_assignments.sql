-- 規格 §17-1～11：專案幹部出作業，派給任何組；每組交 1 份 PDF＋選填說明，規則同雙週進度
-- （2 小時內可改、之後鎖定、只有換 PDF 更新繳交時間），逾期算進專案線的燈號與準時率。
--
-- 三張表：
--   assignments            作業本身（出題者、標題、說明、截止）
--   assignment_groups      派給哪些組
--   assignment_submissions 各組的繳交（內容：PDF、說明）
-- 狀態（交了沒、繳交時間）走 assignment_status 視圖，不含內容欄位。
--
-- 權限（「看得到」都只限當前學期）：
--   作業本身／派給哪些組：所有幹部；專案生只看派給自己組的。
--   繳交內容：該組組員、該組負責專案幹部、出題者（§17-11）。管理員走服務身分。
--   狀態：所有幹部＋該組組員。
-- 寫入一律走只給 service_role 的函式；出題者檢查在函式裡（server action 先確認目前身份是專案幹部）。

create table assignments (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  title text not null check (length(trim(title)) between 1 and 100),
  description text check (description is null or length(description) <= 2000),
  deadline timestamptz not null,
  -- 出題者的名單列（role = pm）。成員只會軟移除（left_at），列不會被刪；學期刪除時一起 cascade。
  created_by uuid not null references members on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assignments_semester_idx on assignments (semester_id);

create table assignment_groups (
  assignment_id uuid not null references assignments on delete cascade,
  group_id uuid not null references groups on delete cascade,
  primary key (assignment_id, group_id)
);
create index assignment_groups_group_idx on assignment_groups (group_id);

create table assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  group_id uuid not null,
  note text check (note is null or length(note) <= 2000),
  submitted_by text not null,
  pdf_key text not null unique,
  pdf_size int not null check (pdf_size between 1 and 20971520),
  pdf_uploaded_at timestamptz not null,
  pdf_uploaded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, group_id),
  -- 只能交「派給自己組」的作業；取消派給某組時，那組的繳交一起刪（出題者已打字確認，§17-8）。
  foreign key (assignment_id, group_id) references assignment_groups on delete cascade
);

-- 鎖定：同雙週進度，看「這一列現在的 pdf_uploaded_at」，滿 2 小時不能改、不能刪。
-- 唯一例外：出題者刪作業／取消派組（update_assignment／delete_assignment 在交易內設
-- app.allow_assignment_delete = 'on'），只放行 DELETE。一般使用者沒有這張表的 delete 權限，
-- 設了旗標也走不到這裡；學生撤回是另一個交易，旗標不存在。
create function reject_if_assignment_locked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_assignment_delete', true) = 'on' then
    return old;
  end if;
  if now() >= old.pdf_uploaded_at + interval '2 hours' then
    raise exception 'LOCKED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function reject_if_assignment_locked() from public, anon, authenticated;

create trigger assignment_submission_lock before update or delete on assignment_submissions
  for each row execute function reject_if_assignment_locked();

-- ─────────────────────────────────────────────────────────────────────────────
-- 讀取權限
-- ─────────────────────────────────────────────────────────────────────────────
alter table assignments enable row level security;
alter table assignment_groups enable row level security;
alter table assignment_submissions enable row level security;

-- 跨表的判斷包成 security definer 函式：policy 直接互相查（assignments ↔ assignment_groups）會無限遞迴。
create function assignment_in_current_semester(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from assignments x join semesters s on s.id = x.semester_id where x.id = a and s.is_current
  )
$$;

-- 派給呼叫者所屬組（專案生身份）的作業。
create function my_assigned_assignments() returns setof uuid
language sql stable security definer set search_path = public as $$
  select assignment_id from assignment_groups where group_id in (select my_groups())
$$;

-- 呼叫者以專案幹部身份出的作業（已離開的身份不算，my_members() 已排除）。
create function my_authored_assignments() returns setof uuid
language sql stable security definer set search_path = public as $$
  select a.id from assignments a where a.created_by in (select id from my_members() where role = 'pm')
$$;

revoke all on function assignment_in_current_semester(uuid) from public, anon;
revoke all on function my_assigned_assignments() from public, anon;
revoke all on function my_authored_assignments() from public, anon;
grant execute on function assignment_in_current_semester(uuid) to authenticated;
grant execute on function my_assigned_assignments() to authenticated;
grant execute on function my_authored_assignments() to authenticated;

create policy read_assignments on assignments for select to authenticated using (
  semester_id = (select id from semesters where is_current limit 1)
  and (is_staff() or id in (select my_assigned_assignments()))
);

create policy read_assignment_groups on assignment_groups for select to authenticated using (
  (is_staff() or group_id in (select my_groups()))
  and assignment_in_current_semester(assignment_id)
);

create policy read_assignment_submissions on assignment_submissions for select to authenticated using (
  (
    group_id in (select my_groups())
    or group_id in (select my_pm_groups())
    or assignment_id in (select my_authored_assignments())
  )
  and assignment_in_current_semester(assignment_id)
);

-- 狀態視圖：同 stage_status 的模式（擁有者身分讀本表、條件寫在視圖裡、security_barrier）。
-- 管理員走伺服器服務身分（JWT role = service_role，沒有名單 email），要明寫放行，否則讀到空的。
create view assignment_status with (security_invoker = false, security_barrier = true) as
  select s.assignment_id, s.group_id, s.pdf_uploaded_at
  from assignment_submissions s
  join assignments a on a.id = s.assignment_id
  where (auth.role() = 'service_role' or is_staff() or s.group_id in (select my_groups()))
    and a.semester_id = (select id from semesters where is_current limit 1);

revoke all on assignments, assignment_groups, assignment_submissions, assignment_status from public, anon, authenticated;
grant select on assignments, assignment_groups, assignment_submissions, assignment_status to authenticated;
grant select on assignment_status to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 出題者：建立／修改／刪除
-- ─────────────────────────────────────────────────────────────────────────────
-- 出題者必須是當前學期、沒離開、role = pm 的名單列。
create function assert_assignment_author(p_member_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_semester uuid;
begin
  select m.semester_id into v_semester
  from members m join semesters s on s.id = m.semester_id
  where m.id = p_member_id and m.role = 'pm' and m.left_at is null and s.is_current;
  if v_semester is null then
    raise exception '只有專案幹部可以出作業';
  end if;
  return v_semester;
end $$;

create function assert_assignment_groups(p_semester_id uuid, p_group_ids uuid[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_group_ids is null or cardinality(p_group_ids) = 0 then
    raise exception '至少要派給一組';
  end if;
  if exists (
    select 1 from unnest(p_group_ids) g
    where not exists (select 1 from groups where id = g and semester_id = p_semester_id)
  ) then
    raise exception '組別不屬於本學期';
  end if;
end $$;

create function create_assignment(
  p_author uuid, p_title text, p_description text, p_deadline timestamptz, p_group_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_semester uuid;
  v_id uuid;
begin
  v_semester := assert_assignment_author(p_author);
  perform assert_assignment_groups(v_semester, p_group_ids);
  insert into assignments (semester_id, title, description, deadline, created_by)
  values (v_semester, trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_deadline, p_author)
  returning id into v_id;
  insert into assignment_groups (assignment_id, group_id)
  select v_id, g from (select distinct unnest(p_group_ids) as g) x;
  return v_id;
end $$;

-- 鎖住作業、確認呼叫者是出題者，回傳學期 id。
create function lock_own_assignment(p_assignment_id uuid, p_author uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_created_by uuid;
  v_semester uuid;
begin
  select created_by, semester_id into v_created_by, v_semester
  from assignments where id = p_assignment_id for update;
  if not found or v_created_by <> p_author then
    raise exception '找不到這份作業';
  end if;
  perform assert_assignment_author(p_author);
  return v_semester;
end $$;

-- 修改：標題、說明、截止、派給的組。取消派給「已經交了」的組時，p_confirm_count 必須等於那些組
-- 的數量（畫面上打字確認過），否則 raise 'needs_confirm:N'，什麼都不動。回傳被刪掉的 pdf_key，
-- 呼叫端在交易 commit 之後才刪 R2 物件。
create function update_assignment(
  p_assignment_id uuid, p_author uuid, p_title text, p_description text, p_deadline timestamptz,
  p_group_ids uuid[], p_confirm_count int default 0
) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_semester uuid;
  v_removed uuid[];
  v_submitted int;
  v_keys text[];
begin
  v_semester := lock_own_assignment(p_assignment_id, p_author);
  perform assert_assignment_groups(v_semester, p_group_ids);
  -- 鎖住派組的列：繳交 insert 會對它拿 key share，跟 for update 互斥，數完已交組數到真的刪掉之間
  -- 不會有人插隊交件（插隊的會等這個交易結束，之後派組已不在，insert 失敗）。
  perform 1 from assignment_groups where assignment_id = p_assignment_id for update;

  select coalesce(array_agg(group_id), '{}') into v_removed
  from assignment_groups
  where assignment_id = p_assignment_id and not (group_id = any (p_group_ids));

  select count(*) into v_submitted
  from assignment_submissions where assignment_id = p_assignment_id and group_id = any (v_removed);
  if v_submitted > 0 and coalesce(p_confirm_count, 0) <> v_submitted then
    raise exception 'needs_confirm:%', v_submitted;
  end if;

  update assignments
  set title = trim(p_title),
      description = nullif(trim(coalesce(p_description, '')), ''),
      deadline = p_deadline,
      updated_at = now()
  where id = p_assignment_id;

  select coalesce(array_agg(pdf_key), '{}') into v_keys
  from assignment_submissions where assignment_id = p_assignment_id and group_id = any (v_removed);

  perform set_config('app.allow_assignment_delete', 'on', true);
  delete from assignment_groups where assignment_id = p_assignment_id and group_id = any (v_removed);
  perform set_config('app.allow_assignment_delete', 'off', true);

  insert into assignment_groups (assignment_id, group_id)
  select p_assignment_id, g from (select distinct unnest(p_group_ids) as g) x
  on conflict do nothing;

  return v_keys;
end $$;

create function delete_assignment(p_assignment_id uuid, p_author uuid, p_confirm_count int default 0)
returns text[]
language plpgsql security definer set search_path = public as $$
declare
  v_submitted int;
  v_keys text[];
begin
  perform lock_own_assignment(p_assignment_id, p_author);
  perform 1 from assignment_groups where assignment_id = p_assignment_id for update; -- 同 update_assignment

  select count(*), coalesce(array_agg(pdf_key), '{}') into v_submitted, v_keys
  from assignment_submissions where assignment_id = p_assignment_id;
  if v_submitted > 0 and coalesce(p_confirm_count, 0) <> v_submitted then
    raise exception 'needs_confirm:%', v_submitted;
  end if;

  perform set_config('app.allow_assignment_delete', 'on', true);
  delete from assignments where id = p_assignment_id;
  perform set_config('app.allow_assignment_delete', 'off', true);

  return v_keys;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 組員：繳交／換 PDF（同 submit_progress_report／replace_progress_report 的上傳票模式）
-- ─────────────────────────────────────────────────────────────────────────────
create function submit_assignment(
  p_pdf_key text, p_issuer_email text, p_assignment_id uuid, p_group_id uuid, p_note text,
  p_submitted_by text, p_pdf_size int, p_pdf_uploaded_at timestamptz, p_pdf_uploaded_by text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  update upload_tickets set used_at = now()
  where key = p_pdf_key and issuer_email = p_issuer_email and used_at is null;
  if not found then
    raise exception 'invalid_ticket';
  end if;

  insert into assignment_submissions (
    assignment_id, group_id, note, submitted_by, pdf_key, pdf_size, pdf_uploaded_at, pdf_uploaded_by
  ) values (
    p_assignment_id, p_group_id, nullif(trim(coalesce(p_note, '')), ''), p_submitted_by,
    p_pdf_key, p_pdf_size, p_pdf_uploaded_at, p_pdf_uploaded_by
  ) returning id into v_id;
  return v_id;
end $$;

create function replace_assignment_pdf(
  p_submission_id uuid, p_old_pdf_key text, p_pdf_key text, p_issuer_email text,
  p_pdf_size int, p_pdf_uploaded_at timestamptz, p_pdf_uploaded_by text
) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_current_key text;
  v_old_uploaded_at timestamptz;
begin
  select pdf_key, pdf_uploaded_at into v_current_key, v_old_uploaded_at
  from assignment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission_not_found';
  end if;
  if v_current_key <> p_old_pdf_key then
    raise exception 'stale_write';
  end if;

  update upload_tickets set used_at = now()
  where key = p_pdf_key and issuer_email = p_issuer_email and used_at is null;
  if not found then
    raise exception 'invalid_ticket';
  end if;

  update assignment_submissions
  set pdf_key = p_pdf_key, pdf_size = p_pdf_size, pdf_uploaded_at = p_pdf_uploaded_at,
      pdf_uploaded_by = p_pdf_uploaded_by, updated_at = now()
  where id = p_submission_id;
  return v_old_uploaded_at;
end $$;

revoke all on function assert_assignment_author(uuid) from public, anon, authenticated;
revoke all on function assert_assignment_groups(uuid, uuid[]) from public, anon, authenticated;
revoke all on function create_assignment(uuid, text, text, timestamptz, uuid[]) from public, anon, authenticated;
revoke all on function lock_own_assignment(uuid, uuid) from public, anon, authenticated;
revoke all on function update_assignment(uuid, uuid, text, text, timestamptz, uuid[], int) from public, anon, authenticated;
revoke all on function delete_assignment(uuid, uuid, int) from public, anon, authenticated;
revoke all on function submit_assignment(text, text, uuid, uuid, text, text, int, timestamptz, text) from public, anon, authenticated;
revoke all on function replace_assignment_pdf(uuid, text, text, text, int, timestamptz, text) from public, anon, authenticated;
grant execute on function create_assignment(uuid, text, text, timestamptz, uuid[]) to service_role;
grant execute on function update_assignment(uuid, uuid, text, text, timestamptz, uuid[], int) to service_role;
grant execute on function delete_assignment(uuid, uuid, int) to service_role;
grant execute on function submit_assignment(text, text, uuid, uuid, text, text, int, timestamptz, text) to service_role;
grant execute on function replace_assignment_pdf(uuid, text, text, text, int, timestamptz, text) to service_role;
