-- Batch 2 Task 4：比賽線的三個階段（報名／繳件／決賽）繳交紀錄。
--
-- 這裡只建表與 RLS；上傳動作、鎖定 trigger 是 Task 5 的範圍（跟 progress_reports／
-- progress_lock 是同一套模式：pdf_uploaded_at 之後滿 2 小時鎖定，Task 5 再補 trigger）。
--
-- stage_submissions：每次上傳一筆，保留每一版（退回重交不覆蓋舊版）。unique(line_id, stage,
-- version) 保證同一條線同一階段的版號不重複；pdf_key 全表 unique（跟 progress_reports 的
-- pdf_key 一樣，直接對應 R2 上實際的物件 key，不該有兩筆紀錄指到同一個檔案）。
create table stage_submissions (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references lines on delete cascade,
  stage text not null check (stage in ('signup', 'submission', 'final')),
  version int not null,
  pdf_key text not null unique,
  pdf_size int not null,
  pdf_uploaded_at timestamptz not null,
  pdf_uploaded_by text not null,
  submitted_by text not null,
  created_at timestamptz not null default now(),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'returned')),
  reviewed_by text,
  reviewed_at timestamptz,
  comment text,
  unique (line_id, stage, version)
);

alter table stage_submissions enable row level security;

-- 看得到內容（PDF、退回原因）：管理員、專案幹部、自己組——跟 progress_reports／checkins 同一顆
-- can_read_content()。其他幹部看不到內容，只能透過下面的 stage_status 視圖看狀態。
grant select on stage_submissions to authenticated;

create policy read_stage_submissions on stage_submissions for select to authenticated using (
  can_read_content(line_id)
);

-- 狀態視圖：不含 pdf_key、comment、reviewed_by 這些內容欄位，給所有幹部（含其他幹部）與
-- 管理員算燈號、階段、準時率用——跟 line_light_events 同一個模式（security_invoker = false +
-- security_barrier，WHERE can_read_status(line_id) 在視圖定義裡，不讓外層查詢的篩選條件在
-- can_read_status() 之前先跑）。
create view stage_status with (security_invoker = false, security_barrier = true) as
  select line_id, stage, version, pdf_uploaded_at, review_status, reviewed_at
  from stage_submissions
  where can_read_status(line_id);

grant select on stage_status to authenticated;

-- 批次 2 收緊的預設權限：沒有任何 insert/update/delete 開放給 authenticated；Task 5 會加
-- upload/review 用的 RPC，一律只給 service_role（跟 confirm_entry() 同一套模式）。
