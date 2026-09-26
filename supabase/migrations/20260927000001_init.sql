create type role as enum ('pm','officer','student');
create type light as enum ('green','yellow','red');

create table semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_current boolean not null default false,
  red_after_hours int not null default 72 check (red_after_hours between 1 and 720),
  created_at timestamptz not null default now()
);
create unique index one_current_semester on semesters (is_current) where is_current;

create table groups (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  name text not null,
  project_name text not null,
  unique (semester_id, name)
);

create table members (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  email text not null check (email = lower(email) and email like '%@g.nccu.edu.tw'),
  name text not null,
  role role not null,
  group_id uuid references groups on delete restrict,
  check ((role = 'student') = (group_id is not null)),
  unique (semester_id, email)
);

create table pm_assignments (
  pm_member_id uuid not null references members on delete cascade,
  group_id uuid not null references groups on delete cascade,
  primary key (pm_member_id, group_id)
);

create table acknowledgements (
  semester_id uuid not null references semesters on delete cascade,
  email text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (semester_id, email)
);

create table lines (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  kind text not null check (kind in ('project','competition')),
  created_at timestamptz not null default now()
);
create unique index one_project_line on lines (group_id) where kind = 'project';

create table periods (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  seq int not null,
  deadline timestamptz not null,
  unique (semester_id, seq)
);

create table progress_reports (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references lines on delete cascade,
  period_id uuid not null references periods on delete cascade,
  light light not null,
  did text not null check (length(trim(did)) > 0),
  blocked text not null check (length(trim(blocked)) > 0),
  next_steps text not null check (length(trim(next_steps)) > 0),
  submitted_by text not null,
  pdf_key text not null,
  pdf_size int not null check (pdf_size between 1 and 20971520),
  pdf_uploaded_at timestamptz not null,
  pdf_uploaded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, period_id)
);

create table checkins (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references lines on delete cascade,
  light light not null,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (light <> 'red' or length(trim(coalesce(note,''))) > 0)
);

-- 權限輔助函式
create function me() returns members language sql stable security definer set search_path = public as $$
  select m.* from members m join semesters s on s.id = m.semester_id
  where s.is_current and m.email = lower(auth.jwt() ->> 'email') limit 1
$$;
create function my_group() returns uuid language sql stable as $$ select (me()).group_id $$;
create function is_staff() returns boolean language sql stable as $$ select coalesce((me()).role in ('pm','officer'), false) $$;
create function is_pm() returns boolean language sql stable as $$ select coalesce((me()).role = 'pm', false) $$;
create function line_group(l uuid) returns uuid language sql stable security definer set search_path = public as $$ select group_id from lines where id = l $$;
-- 看得到內容（三句話、PDF、紅燈說明）：自己組員＋專案幹部。管理員走伺服器服務身分，不經過這些規則。
create function can_read_content(l uuid) returns boolean language sql stable as $$ select is_pm() or line_group(l) = my_group() $$;
-- 看得到狀態（燈號、繳交時間）：所有幹部＋自己組員
create function can_read_status(l uuid) returns boolean language sql stable as $$ select is_staff() or line_group(l) = my_group() $$;

alter table semesters enable row level security;
alter table groups enable row level security;
alter table members enable row level security;
alter table pm_assignments enable row level security;
alter table acknowledgements enable row level security;
alter table lines enable row level security;
alter table periods enable row level security;
alter table progress_reports enable row level security;
alter table checkins enable row level security;

create policy read_current_semester on semesters for select using (is_current);
create policy read_groups on groups for select using (is_staff() or id = my_group());
create policy read_members on members for select using (is_staff() or email = (me()).email or group_id = my_group());
create policy read_pm on pm_assignments for select using (is_staff() or group_id = my_group());
create policy read_own_ack on acknowledgements for select using (email = lower(auth.jwt() ->> 'email'));
create policy read_lines on lines for select using (can_read_status(id));
create policy read_periods on periods for select using (me() is not null);
create policy read_reports on progress_reports for select using (can_read_content(line_id));
create policy read_checkins on checkins for select using (can_read_content(line_id));

-- 狀態視圖：不含三句話、PDF、說明文字，給看板用
create view line_light_events with (security_invoker = false) as
  select line_id, light, pdf_uploaded_at as at, period_id from progress_reports where can_read_status(line_id)
  union all
  select line_id, light, created_at as at, null::uuid as period_id from checkins where can_read_status(line_id);

-- 視圖需要明確授權；資料表本身的存取一律由上面的 RLS 決定。
grant select on line_light_events to authenticated;
