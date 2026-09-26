-- 最終整體審查的修正（batch 1 final review）。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- #1 函式的 EXECUTE 預設權限真的從 PUBLIC 收回來
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260927000003_default_privileges.sql 寫的是
--   alter default privileges for role postgres in schema public revoke all on functions from ... public;
-- 但 Postgres 的「per-schema」預設權限只能在全域預設之上「再加」權限，收不掉全域預設。
-- 函式的全域預設（沒有任何 pg_default_acl 設定時）就是 PUBLIC 有 EXECUTE，所以那一行對 PUBLIC
-- 是 no-op：之後新建的函式（例如 reject_if_locked()）一樣自動開給 PUBLIC，而 anon／authenticated
-- 都是 PUBLIC 的成員，等於沒收。
--
-- 正確做法是不寫 `in schema`，直接改 postgres 角色的「全域」預設權限。
alter default privileges for role postgres revoke execute on functions from public;

-- 已經存在、而且 PUBLIC 還有 EXECUTE 的函式，逐一收回（用 catalog 查過：
-- reject_if_locked、my_group、is_staff、is_pm、can_read_content、can_read_status）。
--
-- reject_if_locked() 是 trigger 函式：trigger 觸發時不檢查呼叫者的 EXECUTE 權限，收回不影響
-- progress_lock trigger 的運作。
revoke execute on function reject_if_locked() from public;

-- 下面五個是 RLS 政策裡會呼叫到的輔助函式。RLS 政策以「查詢者」身分執行函式，登入的人
-- （authenticated）一定要保留 EXECUTE；anon 已經沒有任何資料表權限（20260927000002），
-- RLS 政策根本不會以 anon 身分被評估，所以跟 me()／line_group() 一樣收掉 PUBLIC 與 anon。
revoke execute on function my_group() from public, anon;
revoke execute on function is_staff() from public, anon;
revoke execute on function is_pm() from public, anon;
revoke execute on function can_read_content(uuid) from public, anon;
revoke execute on function can_read_status(uuid) from public, anon;
grant execute on function my_group() to authenticated;
grant execute on function is_staff() to authenticated;
grant execute on function is_pm() to authenticated;
grant execute on function can_read_content(uuid) to authenticated;
grant execute on function can_read_status(uuid) to authenticated;
