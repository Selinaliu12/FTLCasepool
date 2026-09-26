-- Fix round 1：安全性加固。
--
-- (1a) 全域規則「只接受 Google 帳號」：me() 原本只看 email 對不對，沒管 email 是從哪個 provider
-- 登入的。只要 Supabase 專案開著 email/password 登入（本機開發預設就是開的），任何人都能拿 anon key
-- 自己 POST /auth/v1/signup 建一個 pm@g.nccu.edu.tw 的帳號，然後被 me() 誤認成真的專案幹部。
-- 修法：me() 只信任 provider = google 的 JWT；email provider 只有在「本機專用開關」打開時才放行。
--
-- 開關原本照 controller ruling 打算用 `alter database postgres set app.allow_email_login = 'on'`
-- 放在 seed.sql 裡（只有本機 `supabase db reset` 會跑，`db push` 到正式站不會執行）。但實測發現
-- Supabase 本機的 `postgres` 角色不是真正的 superuser（真正的 superuser 是 supabase_admin，
-- migrations／seed.sql 都是用 postgres 連線在跑），Postgres 17 對非 superuser 執行
-- `ALTER DATABASE ... SET <自訂 GUC>` 會直接拒絕：
--   ERROR: permission denied to set parameter "app.allow_email_login"
-- （用 supabase_admin 連線跑同一句可以成功，但 seed.sql／migration 沒辦法指定用哪個角色連線，
-- 而且 postgres 也不是 supabase_admin 的成員，SET ROLE 也不行。）
-- 改用一張本機專用的旗標表：postgres 角色本來就是這張表的擁有者，insert 一列跟平常的
-- migration/seed 沒有權限問題，也不用煩惱「PostgREST 連線池要重新連線才讀得到新設定」。
create table local_only_flags (key text primary key, value text not null);
revoke all on local_only_flags from anon, authenticated;

create or replace function me() returns members language sql stable security definer set search_path = public as $$
  select m.* from members m join semesters s on s.id = m.semester_id
  where s.is_current
    and m.email = lower(auth.jwt() ->> 'email')
    and (
      (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
      or (
        (auth.jwt() -> 'app_metadata' ->> 'provider') = 'email'
        and exists (
          select 1 from local_only_flags where key = 'allow_email_login' and value = 'on'
        )
      )
    )
  limit 1
$$;

-- (3) 資料表權限收斂：本機 Supabase 預設會幫新建的資料表／視圖自動開放 anon／authenticated 的
-- 全部權限（insert/update/delete 也在內），完全靠 RLS policy 擋。這裡額外把權限本身收緊，
-- 就算之後有人不小心加了一條寫入政策，沒有底層 GRANT 一樣動不了資料（防禦縱深）。
-- anon：整個 public schema 什麼都不給，所有讀取都要先登入（authenticated）。
revoke all on all tables in schema public from anon;
-- authenticated：只留 select，寫入一律走伺服器的服務身分（Task 8-10 的 server actions）。
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

-- semesters 的 read_current_semester 政策原本沒有限定角色（預設套用到 public，也就是任何角色），
-- 光靠上面 revoke all from anon 理論上已經擋掉 anon，這裡再把政策本身也明確限定只給 authenticated，
-- 雙重保險，不依賴「anon 剛好沒有 table grant」這一件事。
alter policy read_current_semester on semesters to authenticated;

-- (4) me()／line_group() 是 security definer：呼叫者不需要有底層資料表的權限，函式本身用建立者
-- （擁有者）身分繞過 RLS 查資料，是刻意設計來讓 RLS 政策可以互相呼叫而不遞迴。但 Postgres 預設會把
-- EXECUTE 權限開放給 PUBLIC（等於任何角色，包含 anon），代表 anon 可以直接打
-- POST /rest/v1/rpc/line_group 或 /rpc/me，繞過我們以為「anon 什麼都讀不到」的假設。
-- 收回 PUBLIC／anon 的執行權限，只留 authenticated（RLS 政策需要用它們查自己是誰）。
revoke execute on function me() from public;
revoke execute on function me() from anon;
grant execute on function me() to authenticated;

revoke execute on function line_group(uuid) from public;
revoke execute on function line_group(uuid) from anon;
grant execute on function line_group(uuid) to authenticated;

-- (5) line_light_events 的 security_invoker = false 是刻意的（視圖要用擁有者身分繞過
-- progress_reports／checkins 上更嚴格的 read_reports／read_checkins 政策，只套用視圖自己
-- WHERE can_read_status(line_id) 這一層邏輯）。加上 security_barrier，讓 planner 不能把
-- 外層查詢的條件（例如 .eq()／.in() 篩選）在 can_read_status() 之前先跑，避免可能的側路徑資訊外洩
-- （例如靠篩選條件的錯誤訊息或執行時間差異，反推出不該看到的列存不存在）。
alter view line_light_events set (security_invoker = false, security_barrier = true);
