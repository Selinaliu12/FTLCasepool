-- 本機開發用的種子資料。
-- 測試資料一律由 tests/integration/helpers.ts 的 seedSemester()／resetDb() 用服務身分建立，
-- 不放在這裡，避免兩份資料來源互相打架。
-- 這裡故意留空：名單匯入（幹部／專案生）由之後的匯入功能（後續 Task）處理。

-- 只有本機開發／測試會跑這個檔案（`supabase db reset`）；`supabase db push` 到正式站不會執行 seed.sql。
-- 正式規則是「只接受 Google 帳號」（me() 只認 provider = google），但本機用 email+password
-- 建立測試帳號（test-login、tests/integration/helpers.ts 的 clientAs）沒有 google provider，
-- 所以本機另外開一個開關，讓 me() 對 email provider 也放行（見
-- supabase/migrations/20260927000002_security_hardening.sql 裡 local_only_flags 表的註解：
-- 原本想用 `alter database postgres set app.allow_email_login = 'on'`，但本機的 postgres
-- 角色不是 superuser，這句話會被 Postgres 拒絕，所以改成寫一列到一張本機專用的旗標表）。
insert into local_only_flags (key, value) values ('allow_email_login', 'on')
  on conflict (key) do update set value = excluded.value;
