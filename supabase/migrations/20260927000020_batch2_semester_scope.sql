-- Batch 2 final whole-branch review fixes (IMPORTANT 4)：批次 2 新增的 RLS 只讓「組別屬於當前
-- 學期」的列可讀。
--
-- is_staff() 只判斷「呼叫者是不是當前學期的幹部」（me() 只找當前學期的 member 列），不限制他
-- 讀的那一列屬於哪個學期——原本的 read_entries／read_entry_members／read_stage_submissions
-- 與 stage_status 視圖，讓這學期的專案幹部／其他幹部讀得到上學期所有組的報名、參賽成員、
-- 階段繳交與狀態。學生本來就只看得到 my_group()（當前學期的組），這裡的條件對學生不改變結果。
--
-- 學期條件一律寫成「這一列對應的 groups.semester_id = 當前學期」。policy 用 drop + create
-- 重建（同名、同樣 for select to authenticated）；grant 沒有變動，但為了讓這份 migration 自己
-- 就說清楚最終狀態，仍重新 grant 一次。

drop policy if exists read_entries on competition_entries;
create policy read_entries on competition_entries for select to authenticated using (
  (is_staff() or group_id = my_group())
  and exists (
    select 1 from groups g
    where g.id = competition_entries.group_id
      and g.semester_id = (select id from semesters where is_current limit 1)
  )
);

drop policy if exists read_entry_members on entry_members;
create policy read_entry_members on entry_members for select to authenticated using (
  exists (
    select 1
    from competition_entries ce
    join groups g on g.id = ce.group_id
    where ce.id = entry_members.entry_id
      and g.semester_id = (select id from semesters where is_current limit 1)
      and (is_staff() or ce.group_id = my_group())
  )
);

drop policy if exists read_stage_submissions on stage_submissions;
create policy read_stage_submissions on stage_submissions for select to authenticated using (
  can_read_content(line_id)
  and exists (
    select 1 from groups g
    where g.id = line_group(stage_submissions.line_id)
      and g.semester_id = (select id from semesters where is_current limit 1)
  )
);

-- stage_status：security_invoker = false（用擁有者身分讀 stage_submissions，繞過上面更嚴格的
-- 內容 policy），所以學期條件要寫在視圖自己的 WHERE 裡；security_barrier 保留，讓外層的
-- .eq()／.in() 篩選不能搶在 can_read_status() 與學期條件之前執行。欄位不變，用 create or
-- replace（保留既有權限），再明寫一次 grant。
create or replace view stage_status with (security_invoker = false, security_barrier = true) as
  select ss.line_id, ss.stage, ss.version, ss.pdf_uploaded_at, ss.review_status, ss.reviewed_at
  from stage_submissions ss
  where can_read_status(ss.line_id)
    and exists (
      select 1
      from lines l
      join groups g on g.id = l.group_id
      where l.id = ss.line_id
        and g.semester_id = (select id from semesters where is_current limit 1)
    );

revoke all on stage_status from public, anon;
grant select on competition_entries to authenticated;
grant select on entry_members to authenticated;
grant select on stage_submissions to authenticated;
grant select on stage_status to authenticated;
