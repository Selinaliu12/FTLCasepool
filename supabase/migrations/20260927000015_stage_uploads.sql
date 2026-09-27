-- Batch 2 Task 5：比賽階段上傳（報名／繳件／決賽）的寫入路徑——鎖定 trigger、部分唯一索引、
-- 三個 SECURITY DEFINER RPC（submit_stage／replace_stage_pdf／withdraw_stage）。
-- stage_submissions 表與 RLS 已經在 20260927000014_stage_submissions.sql 建好，這裡只補
-- Task 5 範圍：寫入安全鏈跟 progress_reports（Task 9，見 20260927000006/07）同一套模式。

-- 鎖定 trigger：跟 reject_if_locked()（20260927000007_lock.sql）同一套 2 小時規則，但這裡多一個
-- 例外——review 欄位（review_status／reviewed_by／reviewed_at／comment）在鎖定之後還要能被
-- 幹部改（Task 6 審核鎖定後的繳交），所以只有「學生擁有的欄位」被改動時才套用鎖定判斷；
-- 只改 review 欄位（或 DELETE）不受這個放行影響——DELETE（撤回）永遠套用鎖定判斷，review-only
-- 的 UPDATE 永遠不套用。
create function reject_if_locked_stage() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if now() >= old.pdf_uploaded_at + interval '2 hours' then
      raise exception 'LOCKED' using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- UPDATE：只有「學生擁有的欄位」（跟審核無關的那些）真的被改動時，才套用鎖定判斷。
  -- Task 6 審核鎖定後的繳交只會改 review_status／reviewed_by／reviewed_at／comment，
  -- 這些欄位單獨變動不會走進這個 if，不受鎖定擋。
  if new.pdf_key is distinct from old.pdf_key
     or new.pdf_size is distinct from old.pdf_size
     or new.pdf_uploaded_at is distinct from old.pdf_uploaded_at
     or new.pdf_uploaded_by is distinct from old.pdf_uploaded_by
     or new.submitted_by is distinct from old.submitted_by
     or new.stage is distinct from old.stage
     or new.version is distinct from old.version
     or new.line_id is distinct from old.line_id
  then
    if now() >= old.pdf_uploaded_at + interval '2 hours' then
      raise exception 'LOCKED' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

create trigger stage_submissions_lock before update or delete on stage_submissions
  for each row execute function reject_if_locked_stage();

-- 每條線每個階段同時只能有一份「待審或已通過」的版本：被退回後才能交下一版。這個部分唯一索引
-- 是最後一道防線——submit_stage() 裡的 select 檢查不是原子的，兩個組員幾乎同時送出同一階段的
-- 第一版時，其中一個 insert 會撞這個索引（23505），呼叫端對應成「這個階段已經交了」。
create unique index one_active_submission_per_stage
  on stage_submissions (line_id, stage) where review_status in ('pending', 'approved');

-- submit_stage()：第一次送出、或退回重交（此時該階段沒有 pending／approved 的版本）。
-- version = 該階段目前最大版號 + 1（第一次是 1）。跟 submit_progress_report() 同一套「原子性
-- 標記票用掉＋寫入」模式；「這個階段已經有待審或已通過的版本」用 exception 'stage_active' 表示，
-- 呼叫端（src/server/actions/stages.ts）對應成「這個階段已經交了，等審核結果或被退回後再重交」。
create function submit_stage(
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
begin
  select count(*) into v_active_count
  from stage_submissions
  where line_id = p_line_id and stage = p_stage and review_status in ('pending', 'approved');

  if v_active_count > 0 then
    raise exception 'stage_active';
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

revoke all on function submit_stage(uuid, text, text, int, text, text) from public, anon, authenticated;
grant execute on function submit_stage(uuid, text, text, int, text, text) to service_role;

-- replace_stage_pdf()：2 小時內換 PDF。跟 replace_progress_report() 同一套 FOR UPDATE +
-- stale_write 競態防護——p_old_key 必須跟資料庫這一刻的 pdf_key 一致，否則丟 'stale_write'。
-- 真正的 update 會觸發 stage_submissions_lock（pdf_key 變動屬於「學生擁有的欄位」），已鎖定會
-- 丟 LOCKED。回傳換檔前的 pdf_uploaded_at，讓呼叫端（跟 replaceProgressPdf 一樣）用同一個交易
-- 裡讀到的舊時間判斷是否變成逾期繳交。
create function replace_stage_pdf(
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
begin
  select pdf_key, pdf_uploaded_at into v_current_key, v_old_uploaded_at
  from stage_submissions where id = p_submission_id for update;

  if not found then
    raise exception 'submission_not_found';
  end if;

  if v_current_key <> p_old_key then
    raise exception 'stale_write';
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

revoke all on function replace_stage_pdf(uuid, text, text, int, text, text) from public, anon, authenticated;
grant execute on function replace_stage_pdf(uuid, text, text, int, text, text) to service_role;

-- withdraw_stage()：2 小時內撤回（整筆刪除、不留紀錄、不算版本）。真正的 delete 會觸發
-- stage_submissions_lock（DELETE 一律套用鎖定判斷），已鎖定會丟 LOCKED。回傳被刪的那一列的
-- pdf_key，讓呼叫端刪對應的 R2 物件。
create function withdraw_stage(p_submission_id uuid) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  delete from stage_submissions where id = p_submission_id returning pdf_key into v_key;

  if v_key is null then
    raise exception 'submission_not_found';
  end if;

  return v_key;
end;
$$;

revoke all on function withdraw_stage(uuid) from public, anon, authenticated;
grant execute on function withdraw_stage(uuid) to service_role;
