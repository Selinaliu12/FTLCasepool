-- 狀態視圖讓 service_role 通過。
--
-- line_light_events／stage_status 是 security_invoker = false，WHERE 用 can_read_status()
-- 判斷，而 can_read_status() → is_staff()／my_groups() 只看 auth.jwt() 裡的會員信箱。管理員
-- 看板（src/server/queries/dashboard.ts，目前身份是管理員 → createServiceSupabase()）用的
-- service_role JWT 沒有信箱，兩個視圖對它一律回 0 列：每一組的雙週報告、比賽階段繳交看起來
-- 都沒交，燈號與準時率全錯。
--
-- 在 WHERE 前面加 current_user = 'service_role'。看的是資料庫角色（PostgREST 只有在 JWT 用
-- service key 簽、role = service_role 時才會 set role service_role），不是 JWT claim——
-- authenticated 連線就算 claim 自稱 service_role 也過不了（整合測試釘住）。security_invoker
-- 不影響 current_user：視圖只把資料表權限換成擁有者，current_user 仍是呼叫者。
--
-- 其他部分不變：security_barrier 保留（外層 .eq()／.in() 不能搶在可讀條件之前執行）；
-- stage_status 的「本學期」條件對 service_role 一樣適用。欄位不變，用 create or replace
-- （保留既有權限）。

create or replace view line_light_events with (security_invoker = false, security_barrier = true) as
  select line_id, light, pdf_uploaded_at as at, period_id from progress_reports
  where current_user = 'service_role' or can_read_status(line_id)
  union all
  select line_id, light, created_at as at, null::uuid as period_id from checkins
  where current_user = 'service_role' or can_read_status(line_id);

create or replace view stage_status with (security_invoker = false, security_barrier = true) as
  select ss.line_id, ss.stage, ss.version, ss.pdf_uploaded_at, ss.review_status, ss.reviewed_at
  from stage_submissions ss
  where (current_user = 'service_role' or can_read_status(ss.line_id))
    and exists (
      select 1
      from lines l
      join groups g on g.id = l.group_id
      where l.id = ss.line_id
        and g.semester_id = (select id from semesters where is_current limit 1)
    );

revoke all on line_light_events from public, anon;
revoke all on stage_status from public, anon;
grant select on line_light_events to authenticated;
grant select on stage_status to authenticated;
