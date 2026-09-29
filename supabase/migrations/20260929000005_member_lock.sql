-- Task 6 fix round 1（controller ruling）。
--
-- F2：所有會寫 members 的函式（admin_add_member／admin_update_person／admin_change_email／
--     新的 admin_edit_person／Task 7 未來的移除函式）改用同一個共用的 advisory lock
--     namespace 'member:<semester_id>:<email>'，取代原本各自為政的 'admin_add_member:...'／
--     'admin_change_email:...'。原因：兩個不同 namespace 的鎖互不排隊，admin_add_member(X)
--     跟 admin_change_email(A, X) 可以同時通過「X 不存在／不在名單上」的檢查，都成功寫入，
--     繞過唯一性保護。改信箱一次可能牽涉兩個信箱（舊、新），照信箱字串排序依序上鎖（永遠先鎖
--     字典序較小的那個），避免「A 改信箱鎖 X 後鎖 Y、B 改信箱鎖 Y 後鎖 X」這種順序不一致造成的
--     死鎖。這裡用 create or replace 重新定義 admin_add_member（原本定義在
--     20260929000003_member_admin.sql，那份 migration 已經跑過、不能改，所以在新的 migration
--     裡 create or replace 覆蓋它）與 admin_change_email／admin_update_person（原本定義在
--     20260929000004_member_edit.sql，同一個理由）。
--
-- F5：「舊信箱已經有紀錄」只看本學期（p_semester_id）的紀錄，不看以前學期留下的歷史——換過
--     學期的同一個信箱如果以前學期交過東西，不該卡住這學期改信箱這個動作（以前學期的紀錄本來
--     就還是連到以前學期的 members 列，不受這次改信箱影響）。抽成一個共用的
--     member_has_records() helper，admin_change_email() 與新的 admin_edit_person() 共用，
--     避免兩份重複的檢查邏輯後續改一個忘記改另一個。
--
--     upload_tickets 沒有 semester_id、也沒有 line_id／group_id 可以 join 回 groups.semester_id
--     ——但每一把 key 的字首就是申請當下的學期名稱（見 requestPdfUpload()／
--     src/server/actions/upload.ts:33，以及 stages.ts／progress.ts 用同一個
--     `${semester.name}/${groupId}/...` 慣例），所以用 `key like (學期名稱 || '/%')` 當作
--     semester 範圍的判斷依據，而不是整張表照信箱查。
--
-- F6／F7：三個函式都不再信任呼叫端已經正規化過——email 一律 lower(btrim(...))，
--     admin_update_person／admin_edit_person 的姓名一律 btrim(...) 再檢查空白。這幾個函式只
--     grant 給 service_role，呼叫端（src/server/actions/admin.ts）本來就已經正規化過一次，這裡
--     是 defense-in-depth：直接對著資料庫用 service_role 呼叫的人（例如未來新的呼叫端、或手動
--     操作）不會因為忘記正規化而得到一個看起來像 bug 的資料庫錯誤。
--
-- F1：新增 admin_edit_person()，姓名／學號／系級／信箱一次一個交易寫完——UI 的「編輯」對話框
--     改成只呼叫這一個函式（見 src/server/actions/admin.ts 的 editPerson()），不會再出現
--     「信箱改成功、姓名沒改成功」這種半吊子狀態。admin_update_person()／admin_change_email()
--     保留（其他呼叫端／既有測試還在用），不因為新增這個函式而拿掉。
--
-- F3：新信箱正規化後跟舊信箱一樣＝沒有要換信箱，直接當成功（不查「是否已在名單上」——本來就是
--     它自己那一列）。admin_change_email() 與 admin_edit_person() 都適用。

-- ---- helper：本學期是否已經有這個信箱的紀錄 ----
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
        where issuer_email = p_email and key like (v_semester_name || '/%')
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

-- ---- admin_add_member()：跟 20260929000003 一樣的規則，只換 advisory lock 的 namespace（F2）----
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
  v_existing members%rowtype;
  v_id uuid;
begin
  if not exists (select 1 from semesters where id = p_semester_id and is_current) then
    raise exception '只能在本學期新增成員';
  end if;
  if (p_role = 'student') <> (p_group_id is not null) then
    raise exception '%', case when p_role = 'student' then '專案生要選組別' else '幹部不能填組別' end;
  end if;
  if p_group_id is not null
     and not exists (select 1 from groups where id = p_group_id and semester_id = p_semester_id) then
    raise exception '組別不屬於本學期';
  end if;

  perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || p_email));

  if exists (
    select 1 from members
    where semester_id = p_semester_id and email = p_email and left_at is null
      and (name is distinct from p_name
           or student_id is distinct from p_student_id
           or dept_year is distinct from p_dept_year)
  ) then
    raise exception '同一個信箱的姓名／學號／系級要一致';
  end if;

  select * into v_existing from members
  where semester_id = p_semester_id and email = p_email and role = p_role
    and coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if found then
    if v_existing.left_at is null then
      raise exception '這個人已經有這個身份';
    end if;
    update members
      set left_at = null, name = p_name, student_id = p_student_id, dept_year = p_dept_year
      where id = v_existing.id;
    return jsonb_build_object('id', v_existing.id, 'restored', true);
  end if;

  insert into members (semester_id, email, name, role, student_id, dept_year, group_id)
  values (p_semester_id, p_email, p_name, p_role, p_student_id, p_dept_year, p_group_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'restored', false);
exception
  when unique_violation then
    raise exception '這個人已經有這個身份';
end;
$$;

revoke all on function admin_add_member(uuid, text, text, role, text, text, uuid) from public, anon, authenticated;
grant execute on function admin_add_member(uuid, text, text, role, text, text, uuid) to service_role;

-- ---- admin_update_person()：F6／F7 正規化 + F2 共用鎖 namespace ----
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
  v_email text := lower(btrim(p_email));
  v_name text := btrim(p_name);
  v_rows int;
begin
  if v_name = '' then
    raise exception '姓名不能空白';
  end if;

  perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_email));

  update members
    set name = v_name, student_id = p_student_id, dept_year = p_dept_year
    where semester_id = p_semester_id and email = v_email;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception '找不到這個人';
  end if;
end;
$$;

revoke all on function admin_update_person(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function admin_update_person(uuid, text, text, text, text) to service_role;

-- ---- admin_change_email()：F2 共用鎖 namespace（鎖新舊兩個信箱，依字典序排序避免死鎖，
--      上鎖後才重查一次「新信箱是否已在名單上」）、F3 同信箱視為成功、F5 紀錄檢查只看本學期
--      （member_has_records()）、F6／F7 正規化 ----
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
  v_old text := lower(btrim(p_old_email));
  v_new text := lower(btrim(p_new_email));
  v_lock_a text;
  v_lock_b text;
begin
  if v_new is null or v_new !~ '^[^@\s]+@g\.nccu\.edu\.tw$' then
    raise exception 'email 必須是 @g.nccu.edu.tw';
  end if;

  if v_old = v_new then
    -- F3：正規化後信箱沒有變，當成功，不用檢查「已經在名單上」（本來就是它自己那一列）。
    if not exists (select 1 from members where semester_id = p_semester_id and email = v_old) then
      raise exception '找不到這個人';
    end if;
    return;
  end if;

  if v_old < v_new then v_lock_a := v_old; v_lock_b := v_new;
  else v_lock_a := v_new; v_lock_b := v_old; end if;
  perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_lock_a));
  perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_lock_b));

  if not exists (select 1 from members where semester_id = p_semester_id and email = v_old) then
    raise exception '找不到這個人';
  end if;

  -- 上鎖之後才做這個檢查（F2）：上鎖之前查過一次也沒用，兩個管理員可能同時通過上鎖前的檢查；
  -- 真正有意義的是「拿到鎖之後」看到的資料庫狀態。
  if exists (select 1 from members where semester_id = p_semester_id and email = v_new) then
    raise exception '這個信箱已經在本學期名單上';
  end if;

  if member_has_records(p_semester_id, v_old) then
    raise exception '這個人已經有紀錄，不能改信箱；請移除後用新信箱新增';
  end if;

  update members set email = v_new where semester_id = p_semester_id and email = v_old;

  delete from acknowledgements where semester_id = p_semester_id and email = v_new;
  update acknowledgements set email = v_new where semester_id = p_semester_id and email = v_old;
end;
$$;

revoke all on function admin_change_email(uuid, text, text) from public, anon, authenticated;
grant execute on function admin_change_email(uuid, text, text) to service_role;

-- ---- admin_edit_person()：F1 姓名／學號／系級／信箱一次一個交易寫完 ----
--
-- UI 的「編輯」對話框改成只呼叫這一個函式（src/server/actions/admin.ts 的 editPerson()）：不會
-- 再出現「changeEmail 成功、updatePerson 失敗」這種半吊子狀態，也不會有 revalidatePath 把 email
-- 改完那次的 RSC 重新渲染，把還在跑第二次呼叫的 Dialog 元件卸載掉的問題（因為根本沒有第二次
-- 呼叫）。姓名／信箱都在同一段檢查完、同一個 UPDATE 裡寫完。
create or replace function admin_edit_person(
  p_semester_id uuid,
  p_old_email text,
  p_new_email text,
  p_name text,
  p_student_id text,
  p_dept_year text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text := lower(btrim(p_old_email));
  v_new text := lower(btrim(p_new_email));
  v_name text := btrim(p_name);
  v_lock_a text;
  v_lock_b text;
  v_rows int;
begin
  if v_name = '' then
    raise exception '姓名不能空白';
  end if;
  if v_new is null or v_new !~ '^[^@\s]+@g\.nccu\.edu\.tw$' then
    raise exception 'email 必須是 @g.nccu.edu.tw';
  end if;

  if v_old = v_new then
    perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_old));
  else
    if v_old < v_new then v_lock_a := v_old; v_lock_b := v_new;
    else v_lock_a := v_new; v_lock_b := v_old; end if;
    perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_lock_a));
    perform pg_advisory_xact_lock(hashtext('member:' || p_semester_id::text || ':' || v_lock_b));
  end if;

  if not exists (select 1 from members where semester_id = p_semester_id and email = v_old) then
    raise exception '找不到這個人';
  end if;

  if v_old <> v_new then
    -- F2：上鎖之後才查「新信箱是否已在名單上」。
    if exists (select 1 from members where semester_id = p_semester_id and email = v_new) then
      raise exception '這個信箱已經在本學期名單上';
    end if;
    if member_has_records(p_semester_id, v_old) then
      raise exception '這個人已經有紀錄，不能改信箱；請移除後用新信箱新增';
    end if;
  end if;

  update members
    set email = v_new, name = v_name, student_id = p_student_id, dept_year = p_dept_year
    where semester_id = p_semester_id and email = v_old;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception '找不到這個人';
  end if;

  if v_old <> v_new then
    delete from acknowledgements where semester_id = p_semester_id and email = v_new;
    update acknowledgements set email = v_new where semester_id = p_semester_id and email = v_old;
  end if;
end;
$$;

revoke all on function admin_edit_person(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function admin_edit_person(uuid, text, text, text, text, text) to service_role;
