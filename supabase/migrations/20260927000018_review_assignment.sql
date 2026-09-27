-- Batch 2 Task 6 fix round 1（controller ruling）。
--
-- Minor 1：關掉「呼叫者是不是負責這組的 PM」的 TOCTOU 視窗。原本 reviewStage()
-- （src/server/actions/stages.ts）在呼叫 review_stage() 之前先查一次 pm_assignments，通過才
-- 呼叫 RPC；但這兩步不是同一個交易——查完之後、RPC 真的執行 UPDATE 之前，管理員如果剛好把
-- 這個 PM 從這組移走，RPC 本身完全不知道，還是會照審不誤。這裡把「呼叫者是不是負責這組的
-- PM」這個判斷搬進 review_stage() 自己的交易裡，用 FOR UPDATE 鎖住那一列 stage_submissions
-- 之後、真正 UPDATE 之前，再查一次 pm_assignments（同一個交易看到的是當下最新的指派狀態，
-- 不會有查完到用之間的空窗）。找不到指派 raise 'not_assigned'，呼叫端對應成跟其他「沒有權限」
-- 情況同一種「找不到這筆繳交」，不透露「這筆繳交存在，只是你沒被指派」。
--
-- 函式簽名加了 p_pm_member_id，是破壞性改動（不能用 create or replace 加參數），先 drop 舊的
-- 再建新的，grant／revoke 一併重做（新函式的 grant 不會沿用舊函式的）。
--
-- Minor 3：順便把 update 那行多餘的 case when 拿掉——p_decision = 'approved' 跟
-- p_decision = 'returned' 兩個分支結果都是 v_comment，等於是繞了一圈的恆等式，直接寫
-- comment = v_comment 就好。
drop function if exists review_stage(uuid, text, text, text);

create function review_stage(
  p_submission_id uuid,
  p_reviewer text,
  p_pm_member_id uuid,
  p_decision text,
  p_comment text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid;
  v_group_id uuid;
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

  select group_id into v_group_id from lines where id = v_line_id;

  -- 同一個交易裡、鎖住這一列之後才查指派——跟「查完再呼叫」比起來，這裡看到的一定是
  -- UPDATE 真的執行那一刻的指派狀態，不會有查完到用之間被改掉的空窗。
  if not exists (
    select 1 from pm_assignments
    where pm_member_id = p_pm_member_id and group_id = v_group_id
    for share
  ) then
    raise exception 'not_assigned';
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
      comment = v_comment
  where id = p_submission_id;
end;
$$;

revoke all on function review_stage(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function review_stage(uuid, text, uuid, text, text) to service_role;
