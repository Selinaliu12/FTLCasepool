-- Task 2（規格第 15 節 #7）：「已掛上的組別」放寬給每一組看得到——但只有組名，參賽成員、
-- 確認時間、階段檔案、評語照舊只有自己組與幹部看得到（不動 competition_entries／
-- entry_members／stage_submissions 的 RLS）。
--
-- 用一個 SECURITY DEFINER 函式 competition_attached_groups() 單獨開一個窄的讀取管道：只回傳
-- (competition_id, group_name)，不碰任何其他欄位。呼叫者必須是本學期名單上的人
-- （is_member()，跟其他讀取權限一樣是「所有身份的聯集」）；不在名單上的人呼叫這顆函式直接拿
-- 空集合（不是報錯——is_member() 是 false 時 WHERE 條件整段都不成立）。
--
-- 範圍：只有「已發布」的比賽、屬於當前學期、且該組的報名「未退出」（withdrawn_at is null）。
-- 得獎、未入選的組仍然算「掛上」（result 不影響這裡，只看 withdrawn_at）；退出後重新掛，
-- 因為 one_active_entry_per_group_competition 這個部分唯一索引，同一組同一比賽同時只會有一筆
-- withdrawn_at is null 的紀錄，加上這裡用 distinct，組名只會出現一次。
create or replace function competition_attached_groups()
returns table (competition_id uuid, group_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct ce.competition_id, g.name as group_name
  from competition_entries ce
  join competitions c on c.id = ce.competition_id
  join groups g on g.id = ce.group_id
  where ce.withdrawn_at is null
    and c.status = 'published'
    and c.semester_id = (select id from semesters where is_current limit 1)
    and g.semester_id = c.semester_id
    and is_member()
$$;

revoke all on function competition_attached_groups() from public, anon;
grant execute on function competition_attached_groups() to authenticated;
