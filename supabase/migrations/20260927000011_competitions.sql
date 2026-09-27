-- Batch 2 Task 2：競賽卡片（幹部新增／編輯／發布）與競賽大廳。
--
-- 規格第 3 節權限表：新增、編輯、發布競賽只有管理員、專案幹部、其他幹部；寫入一律走
-- service_role（server action 內先用 requireStaff() 檢查身分，再用 service client 寫入），
-- 這裡不開任何 insert/update/delete 給 authenticated。
--
-- 讀取（RLS）：已發布且屬於當前學期 → 名單內所有人（me() 有 member 列）都能看；草稿只有
-- 幹部（is_staff()）看得到。管理員如果自己在名單上沒有 member 列，is_staff() 也會是
-- false（跟 me() 一樣查不到人），這種情況一律走 server 端的 service client（見
-- src/server/queries/competitions.ts），不依賴這裡的 RLS。
create table competitions (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  name text not null,
  organizer text,
  theme text,
  eligibility text,
  team_size text,
  prize text,
  url text not null,
  signup_deadline timestamptz not null,
  submission_deadline timestamptz,
  final_date timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table competitions enable row level security;

-- 批次 2 收緊的預設權限：新表要自己補 grant select，寫入不開放給 authenticated。
grant select on competitions to authenticated;

create policy read_competitions on competitions for select to authenticated using (
  semester_id = (select id from semesters where is_current limit 1)
  and (
    (status = 'published' and (me()).id is not null)
    or is_staff()
  )
);
