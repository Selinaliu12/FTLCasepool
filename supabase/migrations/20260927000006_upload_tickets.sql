-- Task 8 fix round 1：pdfKey 目前沒有跟「誰上傳的」綁在一起，submitProgress() 只檢查
-- key 的字首（學期/組別/...）跟 R2 上實際的檔案，沒有驗證這把 key 本來就是這次呼叫者自己
-- 申請的。結果：
--   情境 A：A2 重放 A1 申請好、A1 也已經交出去的 key K（同一期）——字首檢查過、inspect
--           過，insert 撞到 (line_id, period_id) 的 unique 而丟 23505，接下來的錯誤處理
--           把 K 從 R2 刪掉，等於刪掉 A1 已經交出去的 PDF。
--   情境 B：A2 拿同一把 K 交另一期——兩筆 progress_reports 最後共用同一個 R2 物件。
--
-- 修法：每次 requestPdfUpload() 核發一把 key 的同時，在這張表留一張「票」，記錄是誰申請的、
-- 還沒被用掉。submitProgress() 在真的去檢查 R2 上的檔案之前，先確認這把 key 的票存在、
-- 發給的就是這次呼叫的人、而且還沒被用掉——不是自己申請的 key 一律當「檔案沒有上傳成功」
-- 處理，而且**不刪除**那個物件（沒有理由去動不是自己那份票對應的東西）。
--
-- RLS 開著但完全不開任何 policy、也不 grant 給 anon/authenticated：這張表只有
-- service_role（伺服器端 createServiceSupabase()）能碰，使用者不該、也不需要直接讀寫它。
create table upload_tickets (
  key text primary key,
  issuer_email text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

alter table upload_tickets enable row level security;
-- 故意不建立任何 policy：預設 RLS 開啟＋沒有 policy＝所有人（包含 authenticated）都讀不到、
-- 寫不到，只有繞過 RLS 的 service_role 摸得到這張表。

-- progress_reports 原本只擋「同一條線＋同一期不能交兩次」，沒擋「兩筆報告共用同一個 R2
-- 物件」。情境 B（A2 拿別人的 key 交另一期）如果只靠 ticket 的 issuer_email 檢查，
-- 理論上還是要靠這個資料庫層的限制當最後一道防線（例如同一個人自己對同一把 key 送出
-- 兩次併發請求）。
create unique index progress_reports_pdf_key_idx on progress_reports (pdf_key);

-- submit_progress_report()：把「原子性地標記這張票用掉」跟「寫入 progress_reports」包進
-- 同一個 plpgsql 函式，讓兩件事在同一個交易裡完成——中途任何一步失敗（票已經被別人用掉、
-- 或 insert 撞到 unique 限制），整個函式的效果（包含標記票用掉這件事）都會一起回滾，不會
-- 留下「票被標記用掉、但其實沒有真的寫入報告」的半吊子狀態。
-- 跟 admin_atomic.sql 的 create_semester／save_periods／set_pm_groups 一樣，只 grant 給
-- service_role；呼叫前 TS 端（submitProgress）已經先做過一次非原子性的票務檢查（存在、
-- 屬於自己、還沒用掉）快速擋掉大部分無效請求，這裡的 update ... where used_at is null
-- 再鎖一次，擋掉檢查完、insert 前這段時間窗裡的併發請求。
create or replace function submit_progress_report(
  p_pdf_key text,
  p_issuer_email text,
  p_line_id uuid,
  p_period_id uuid,
  p_light light,
  p_did text,
  p_blocked text,
  p_next_steps text,
  p_submitted_by text,
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

  insert into progress_reports (
    line_id, period_id, light, did, blocked, next_steps,
    submitted_by, pdf_key, pdf_size, pdf_uploaded_at, pdf_uploaded_by
  ) values (
    p_line_id, p_period_id, p_light, p_did, p_blocked, p_next_steps,
    p_submitted_by, p_pdf_key, p_pdf_size, p_pdf_uploaded_at, p_pdf_uploaded_by
  );
end;
$$;

revoke all on function submit_progress_report(
  text, text, uuid, uuid, light, text, text, text, text, int, timestamptz, text
) from public, anon, authenticated;
grant execute on function submit_progress_report(
  text, text, uuid, uuid, light, text, text, text, text, int, timestamptz, text
) to service_role;
