-- Fix round 2：預設權限也要收緊，不然「未來的表」會悄悄把權限開回去。
--
-- 前一份 migration（20260927000002_security_hardening.sql）revoke 的是「現在已經存在」的資料表／
-- 函式的權限。但 Postgres 的 pg_default_acl（預設權限）是另外一回事：只要沒特別設定，postgres
-- 角色（migrations 實際連線在跑的角色）新建的資料表／函式，預設還是會照 Supabase 本機初始化時
-- 設好的規則，自動把權限開給 anon／authenticated（資料表是完整權限，函式是 EXECUTE）。
-- 也就是說，之後只要有人加一張新表或一個新函式，不管有沒有寫 RLS 政策，anon／authenticated
-- 預設就已經摸得到，等於每次新增都要「記得」回頭關權限，很容易漏掉。
--
-- 這份 migration 把「以後 postgres／supabase_admin 建的東西」的預設權限也收緊，跟前一份對「現在
-- 已經存在的東西」做的事情對齊。**這表示之後每一份新的 migration，只要新增資料表或函式，都要自己
-- 明確寫 `grant select ... to authenticated`（資料表／視圖）或 `grant execute ... to authenticated`
-- （RLS 政策裡會呼叫到的函式），不會再像之前那樣預設就摸得到——這是刻意的，寫的時候提醒自己一下。
--
-- `for role postgres`：migrations／seed.sql 實際上都是用 postgres 這個角色連線執行的，這裡明確
-- 針對它設定（雖然不寫 `for role` 時預設也是套用到目前連線的角色，但明確寫出來比較不會之後看不懂）。
-- `for role supabase_admin`：本機的 supabase_admin 是唯一的 superuser，理論上也可能建表／建函式。
-- 但 postgres 角色沒有權限幫另一個角色（supabase_admin）設定它的預設權限
-- （`ALTER DEFAULT PRIVILEGES FOR ROLE` 只有該角色本人或 superuser 能做），實測會拒絕：
--   ERROR: permission denied to change default privileges
-- 所以這裡只保留 `for role postgres` 這一段；supabase_admin 的預設權限沒有改到，記錄在
-- task-4-report.md 的 Fix round 2 章節。目前所有 migration 都是用 postgres 連線跑的，
-- 不是 supabase_admin，所以這個缺口目前不影響本專案。
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
