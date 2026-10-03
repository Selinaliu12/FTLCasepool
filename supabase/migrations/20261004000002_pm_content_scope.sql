-- 規格 §17-12～15：專案幹部只看得到「自己負責的組」的內容（三句話、PDF、紅燈說明、比賽階段檔案與評語）。
-- 別組只看狀態：燈號、繳交時間、準時率走 line_light_events／stage_status（security_invoker = false 的
-- view，條件是 can_read_status），這份 migration 不動它們。
--
-- can_read_content() 是 progress_reports、checkins、stage_submissions 三個 read policy 共用的唯一判斷，
-- 改這一個函式就同時收緊三張表。管理員走伺服器服務身分，不經過 RLS，不受影響。
-- 專案幹部同時是某組專案生時，my_groups() 照舊讓他看得到自己那組（§17-15）。

-- 呼叫者「以專案幹部身份」負責的組（pm_assignments 掛在 pm 那一列的 member id 上）。
-- my_members() 已排除已離開與非當前學期的身份，所以已離開的專案幹部也一起失去負責組。
create or replace function my_pm_groups() returns setof uuid
language sql stable security definer set search_path = public as $$
  select pa.group_id from pm_assignments pa
  join my_members() m on m.id = pa.pm_member_id
  where m.role = 'pm'
$$;

create or replace function can_read_content(l uuid) returns boolean
language sql stable as $$
  select line_group(l) in (select my_groups()) or line_group(l) in (select my_pm_groups())
$$;

revoke all on function my_pm_groups() from public, anon;
grant execute on function my_pm_groups() to authenticated;
