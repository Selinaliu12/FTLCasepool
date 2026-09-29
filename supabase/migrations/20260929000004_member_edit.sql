-- Task 6（規格 §16 第 3、4 點）：管理員修改姓名／學號／系級，以及修改信箱。都是「以人為單位」——
-- 同一信箱的所有身份列（不管還在還是已離開）一起改，讓已離開身份留下的紀錄跟還在的身份顯示同一個
-- 姓名，不會出現同一個人兩個不同姓名的怪狀態。動作一律先確認目前身份是管理員（requireAdmin，跟
-- Task 5 的 addMember 一致）才呼叫這裡的 SECURITY DEFINER 函式；函式本身只給 service_role。

-- (1) admin_update_person()：改姓名／學號／系級。姓名去空白後不能是空字串（跟 validateMemberRow
--     的 name_blank 規則一致，呼叫端 updatePerson() 已經檢查過，這裡再檢查一次當最後一道防線）。
--     學號／系級可以是 null（表單留空）。更新這個信箱在本學期「所有」列，包含已離開的（Task 5 的
--     admin_add_member() 只比較「還在」的身份，這裡改名字則兩種都要改到，紀錄上的名字才會一致）。
create or replace function admin_update_person(
  p_semester_id uuid,
  p_email text,
  p_name text,
  p_student_id text,
  p_dept_year text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception '姓名不能空白';
  end if;

  update members
    set name = p_name, student_id = p_student_id, dept_year = p_dept_year
    where semester_id = p_semester_id and email = p_email;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception '找不到這個人';
  end if;
end;
$$;

revoke all on function admin_update_person(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function admin_update_person(uuid, text, text, text, text) to service_role;

-- (2) admin_change_email()：改信箱，以人為單位（本學期所有列，含已離開的一起改）。
--
--     檢查順序：
--       - 新信箱格式（學校網域）→ 「email 必須是 @g.nccu.edu.tw」（呼叫端 changeEmail() 已經
--         正規化＋檢查過一次；這裡再檢查是因為 admin_change_email() 本身也可能被別的路徑呼叫，
--         而且 members.email 的 check constraint 本來就要求這個格式，提前檢查給看得懂的錯誤
--         訊息而不是讓呼叫端收到 constraint violation）。
--       - 舊信箱在本學期要真的存在（不管還在還是已離開）→ 否則「找不到這個人」。
--       - 新信箱不能已經在本學期名單上（任何一列，還在或已離開都算——已離開的列之後可能被恢復，
--         不能讓新信箱撞上它）→ 「這個信箱已經在本學期名單上」。
--       - 舊信箱不能已經有紀錄：交件（progress_reports）、上傳票（upload_tickets）、比賽階段
--         （stage_submissions，含審核）、比賽掛組／建立（competition_entries／competitions）
--         這些表都用信箱記「是誰」，改信箱會讓舊紀錄看起來像是新信箱的人做的，所以一律先擋下來
--         → 「這個人已經有紀錄，不能改信箱；請移除後用新信箱新增」。acknowledgements（「我已
--         了解」）不算「紀錄」，改信箱時直接把它一起搬到新信箱（如果新信箱在這學期意外已經有一筆
--         ack，先刪掉那筆再搬，理論上不會發生——新信箱這時候還不在名單上——但求穩）。
--     同一學期＋舊信箱用 advisory lock 排隊，避免兩個管理員同時改同一個人的信箱互相繞過檢查。
create or replace function admin_change_email(
  p_semester_id uuid,
  p_old_email text,
  p_new_email text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_record boolean;
begin
  if p_new_email is null or p_new_email !~ '^[^@\s]+@g\.nccu\.edu\.tw$' then
    raise exception 'email 必須是 @g.nccu.edu.tw';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin_change_email:' || p_semester_id::text || ':' || p_old_email));

  if not exists (select 1 from members where semester_id = p_semester_id and email = p_old_email) then
    raise exception '找不到這個人';
  end if;

  if exists (select 1 from members where semester_id = p_semester_id and email = p_new_email) then
    raise exception '這個信箱已經在本學期名單上';
  end if;

  select
    exists (select 1 from progress_reports where submitted_by = p_old_email or pdf_uploaded_by = p_old_email)
    or exists (select 1 from checkins where created_by = p_old_email)
    or exists (select 1 from upload_tickets where issuer_email = p_old_email)
    or exists (
      select 1 from stage_submissions
      where submitted_by = p_old_email or pdf_uploaded_by = p_old_email or reviewed_by = p_old_email
    )
    or exists (select 1 from competition_entries where created_by = p_old_email)
    or exists (select 1 from competitions where created_by = p_old_email)
  into v_has_record;

  if v_has_record then
    raise exception '這個人已經有紀錄，不能改信箱；請移除後用新信箱新增';
  end if;

  update members set email = p_new_email where semester_id = p_semester_id and email = p_old_email;

  delete from acknowledgements where semester_id = p_semester_id and email = p_new_email;
  update acknowledgements set email = p_new_email where semester_id = p_semester_id and email = p_old_email;
end;
$$;

revoke all on function admin_change_email(uuid, text, text) from public, anon, authenticated;
grant execute on function admin_change_email(uuid, text, text) to service_role;
