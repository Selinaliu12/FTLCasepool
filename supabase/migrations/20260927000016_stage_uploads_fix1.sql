-- Batch 2 Task 5 fix round 1（controller ruling）。
--
-- 1) reject_if_locked_stage()：補兩件事——
--    a) 「學生擁有的欄位」清單補上 id／created_at（防禦性；正常不會有人改這兩欄，但既然叫
--       「學生擁有的欄位」，這兩欄本來就不該被排除在鎖定判斷之外）。
--    b) 新增「review 欄位要在鎖定之後才能改」的另一個方向：只改 review 欄位、但這一列還沒
--       鎖定（now() < old.pdf_uploaded_at + 2 小時）時，raise 'NOT_LOCKED'——Task 6 的審核
--       本來就設計成「鎖定之後才送到專案幹部」，資料庫這裡把這件事也守住，不能靠應用層
--       自己記得。一次 UPDATE 同時改到學生欄位＋review 欄位、而且已經鎖定：學生欄位那支判斷
--       先擋（LOCKED），不會落到 review-only 那個分支。
create or replace function reject_if_locked_stage() returns trigger language plpgsql as $$
declare
  v_student_changed boolean;
  v_review_changed boolean;
  v_locked boolean;
begin
  if tg_op = 'DELETE' then
    if now() >= old.pdf_uploaded_at + interval '2 hours' then
      raise exception 'LOCKED' using errcode = 'P0001';
    end if;
    return old;
  end if;

  v_student_changed := (
    new.id is distinct from old.id
    or new.pdf_key is distinct from old.pdf_key
    or new.pdf_size is distinct from old.pdf_size
    or new.pdf_uploaded_at is distinct from old.pdf_uploaded_at
    or new.pdf_uploaded_by is distinct from old.pdf_uploaded_by
    or new.submitted_by is distinct from old.submitted_by
    or new.stage is distinct from old.stage
    or new.version is distinct from old.version
    or new.line_id is distinct from old.line_id
    or new.created_at is distinct from old.created_at
  );

  v_review_changed := (
    new.review_status is distinct from old.review_status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.comment is distinct from old.comment
  );

  v_locked := now() >= old.pdf_uploaded_at + interval '2 hours';

  if v_student_changed then
    if v_locked then
      raise exception 'LOCKED' using errcode = 'P0001';
    end if;
  elsif v_review_changed then
    if not v_locked then
      raise exception 'NOT_LOCKED' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

-- 2) replace_stage_pdf／withdraw_stage：只能動「目前 review_status = 'pending'」的那一列
--    （已通過／已退回的版本不能再換檔或撤回）。找不到符合條件的列一律 raise
--    'submission_not_found'，跟原本「這筆繳交根本不存在」用同一種錯誤，呼叫端統一對應成
--    「找不到這筆繳交」，不透露「這筆繳交存在，只是狀態不對」。
--
-- 3) submit_stage／replace_stage_pdf 都再檢查一次「這條線是不是已經結束」——應用層
--    （src/server/actions/stages.ts）已經先檢查過一次，這裡是最後一道防線，擋掉「檢查完、
--    真的送出之前，這筆報名剛好被隊友取消／填了結果」這種時間窗。withdraw_stage 刻意不做這個
--    檢查——controller ruling：撤回一份還沒鎖定、還在審核佇列前面的 pending 版本，即使線已經
--    結束也該允許（不然會卡著一筆永遠不會被審的東西）。
create or replace function submit_stage(
  p_line_id uuid,
  p_stage text,
  p_key text,
  p_size int,
  p_by text,
  p_ticket text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count int;
  v_next_version int;
  v_id uuid;
  v_withdrawn_at timestamptz;
  v_result text;
begin
  select count(*) into v_active_count
  from stage_submissions
  where line_id = p_line_id and stage = p_stage and review_status in ('pending', 'approved');

  if v_active_count > 0 then
    raise exception 'stage_active';
  end if;

  select ce.withdrawn_at, ce.result into v_withdrawn_at, v_result
  from lines l join competition_entries ce on ce.id = l.entry_id
  where l.id = p_line_id;

  if v_withdrawn_at is not null or v_result in ('awarded', 'not_selected') then
    raise exception 'ended';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from stage_submissions where line_id = p_line_id and stage = p_stage;

  update upload_tickets
  set used_at = now()
  where key = p_key and issuer_email = p_ticket and used_at is null;

  if not found then
    raise exception 'invalid_ticket';
  end if;

  insert into stage_submissions (
    line_id, stage, version, pdf_key, pdf_size, pdf_uploaded_at, pdf_uploaded_by, submitted_by
  ) values (
    p_line_id, p_stage, v_next_version, p_key, p_size, now(), p_by, p_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function replace_stage_pdf(
  p_submission_id uuid,
  p_old_key text,
  p_new_key text,
  p_size int,
  p_by text,
  p_ticket text
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_key text;
  v_old_uploaded_at timestamptz;
  v_line_id uuid;
  v_withdrawn_at timestamptz;
  v_result text;
begin
  select pdf_key, pdf_uploaded_at, line_id into v_current_key, v_old_uploaded_at, v_line_id
  from stage_submissions where id = p_submission_id and review_status = 'pending' for update;

  if not found then
    raise exception 'submission_not_found';
  end if;

  if v_current_key <> p_old_key then
    raise exception 'stale_write';
  end if;

  select ce.withdrawn_at, ce.result into v_withdrawn_at, v_result
  from lines l join competition_entries ce on ce.id = l.entry_id
  where l.id = v_line_id;

  if v_withdrawn_at is not null or v_result in ('awarded', 'not_selected') then
    raise exception 'ended';
  end if;

  update upload_tickets
  set used_at = now()
  where key = p_new_key and issuer_email = p_ticket and used_at is null;

  if not found then
    raise exception 'invalid_ticket';
  end if;

  update stage_submissions
  set pdf_key = p_new_key,
      pdf_size = p_size,
      pdf_uploaded_at = now(),
      pdf_uploaded_by = p_by
  where id = p_submission_id;

  return v_old_uploaded_at;
end;
$$;

create or replace function withdraw_stage(p_submission_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  delete from stage_submissions where id = p_submission_id and review_status = 'pending' returning pdf_key into v_key;

  if v_key is null then
    raise exception 'submission_not_found';
  end if;

  return v_key;
end;
$$;
