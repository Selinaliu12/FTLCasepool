-- Batch 2 Task 6：專案幹部審核比賽階段繳交。
--
-- review_stage()：SECURITY DEFINER，只給 service_role——跟 submit_stage／replace_stage_pdf／
-- withdraw_stage 同一套模式（誰能呼叫、負責哪個組，全部由呼叫端 src/server/actions/stages.ts
-- 對照 pm_assignments 決定，這支函式本身不重新驗證「這個 p_reviewer 是不是負責這組的 PM」，
-- 只負責「這一列現在能不能被審」這件跟呼叫者是誰無關的資料庫不變量）。
--
-- FOR UPDATE 鎖列，依序檢查：
--   1) 是不是這個 (line_id, stage) 目前最新的一版（Review Focus 3：只能審最新一版，退回重交
--      之後，舊版永遠不能再審，即使還沒被鎖定/還是 pending 也一樣——但 one_active_submission_
--      per_stage 那個部分唯一索引已經保證「pending/approved 版本」全表只有一筆會是最新版，
--      這裡改用「這個 stage 底下 version 最大的那一列」判斷，不依賴 review_status，更直接）。
--   2) review_status 是不是 pending（已經審過的不能再審一次）。
--   3) 這條線是不是已經結束（已退出／未入選／得獎）。
--   4) decision = 'returned' 必須有非空白的 comment。
-- 鎖定判斷交給 stage_submissions_lock trigger（見 20260927000015_stage_uploads.sql）：真正的
-- UPDATE 只改 review 欄位，trigger 只在「還沒鎖定」時擋下 review-only 的變動（NOT_LOCKED），
-- 這裡不重複判斷，避免兩處各自算一次時間、算法漂移。
create function review_stage(
  p_submission_id uuid,
  p_reviewer text,
  p_decision text,
  p_comment text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid;
  v_stage text;
  v_version int;
  v_review_status text;
  v_max_version int;
  v_withdrawn_at timestamptz;
  v_result text;
  v_comment text;
begin
  if p_decision not in ('approved', 'returned') then
    raise exception 'invalid_decision';
  end if;

  select line_id, stage, version, review_status
    into v_line_id, v_stage, v_version, v_review_status
  from stage_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'submission_not_found';
  end if;

  select max(version) into v_max_version
  from stage_submissions
  where line_id = v_line_id and stage = v_stage;

  if v_version <> v_max_version then
    raise exception 'not_latest';
  end if;

  if v_review_status <> 'pending' then
    raise exception 'already_reviewed';
  end if;

  select ce.withdrawn_at, ce.result into v_withdrawn_at, v_result
  from lines l join competition_entries ce on ce.id = l.entry_id
  where l.id = v_line_id;

  if v_withdrawn_at is not null or v_result in ('awarded', 'not_selected') then
    raise exception 'ended';
  end if;

  v_comment := nullif(trim(both from coalesce(p_comment, '')), '');

  if p_decision = 'returned' and v_comment is null then
    raise exception 'comment_required';
  end if;

  update stage_submissions
  set review_status = p_decision,
      reviewed_by = p_reviewer,
      reviewed_at = now(),
      comment = case when p_decision = 'approved' then v_comment else v_comment end
  where id = p_submission_id;
end;
$$;

revoke all on function review_stage(uuid, text, text, text) from public, anon, authenticated;
grant execute on function review_stage(uuid, text, text, text) to service_role;
