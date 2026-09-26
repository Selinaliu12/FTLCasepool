-- Task 9：交完進度後 2 小時內可以修改／換 PDF／撤回，之後鎖定。伺服器端（src/domain/lock.ts
-- 的 isLocked()）是第一道防線，但那只是應用層的判斷——就算伺服器程式有 bug（例如漏了檢查、
-- 或用錯欄位），資料庫本身也要擋下「已鎖定的列被 update／delete」這件事，這是第二道、
-- 真正的防線。
--
-- 鎖定的判斷只看「這一列現在存的 pdf_uploaded_at」（也就是 OLD.pdf_uploaded_at），不看
-- 這次 update 想寫入什麼新值：這樣「編輯燈號跟三句話」「換 PDF」「刪除（撤回）」都會被同一顆
-- trigger、同一套規則擋住，不用在每個寫入路徑各自重寫一次判斷。
create function reject_if_locked() returns trigger language plpgsql as $$
begin
  if now() >= old.pdf_uploaded_at + interval '2 hours' then
    raise exception 'LOCKED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger progress_lock before update or delete on progress_reports
  for each row execute function reject_if_locked();

-- replaceProgressPdf()：跟 submit_progress_report()（見 20260927000006_upload_tickets.sql）
-- 走同一套安全鏈——先在 TS 端做過字首檢查、票務檢查（存在、屬於呼叫者、還沒用掉）、
-- inspectUploaded（真的去確認 R2 上的檔案），這裡再原子性地「標記票用掉」＋「更新
-- progress_reports 的 pdf_key／pdf_size／pdf_uploaded_at／pdf_uploaded_by／updated_at」，
-- 兩件事包在同一個交易裡：任何一步失敗（票已經被用掉、或這一列已經鎖定）都會讓整個函式
-- （包含標記票用掉這件事）一起回滾，不會留下「票被標記用掉、但其實沒有真的換成新檔」的
-- 半吊子狀態。
--
-- update progress_reports ... 那一步會觸發 progress_lock trigger：如果這份報告已經超過
-- 2 小時，trigger 會用 errcode P0001、訊息 'LOCKED' 擋下來，呼叫端（replaceProgressPdf）
-- 把它對應成「已超過 2 小時，已鎖定不能修改」。
--
-- 只 grant 給 service_role，跟其他寫入用的 RPC 一樣（admin_atomic.sql、
-- submit_progress_report）：一般使用者不該、也不需要直接呼叫這個函式。
create or replace function replace_progress_report(
  p_report_id uuid,
  p_pdf_key text,
  p_issuer_email text,
  p_pdf_size int,
  p_pdf_uploaded_at timestamptz,
  p_pdf_uploaded_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update upload_tickets
  set used_at = now()
  where key = p_pdf_key and issuer_email = p_issuer_email and used_at is null;

  if not found then
    raise exception 'invalid_ticket';
  end if;

  update progress_reports
  set pdf_key = p_pdf_key,
      pdf_size = p_pdf_size,
      pdf_uploaded_at = p_pdf_uploaded_at,
      pdf_uploaded_by = p_pdf_uploaded_by,
      updated_at = now()
  where id = p_report_id;

  if not found then
    raise exception 'report_not_found';
  end if;
end;
$$;

revoke all on function replace_progress_report(
  uuid, text, text, int, timestamptz, text
) from public, anon, authenticated;
grant execute on function replace_progress_report(
  uuid, text, text, int, timestamptz, text
) to service_role;
