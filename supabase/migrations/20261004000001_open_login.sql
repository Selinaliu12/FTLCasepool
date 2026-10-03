-- 規格 §17-16～19：校外成員也能登入（任何 Google 帳號），名單上有這個信箱才放行。
--
-- (1) members.email 的網域限制改成「小寫＋基本信箱格式」，跟應用程式的 EMAIL_RE（src/domain/access.ts）一致。
-- (2) 名單相關函式（admin_add_member／admin_change_email／admin_edit_person）裡寫死的網域檢查：
--     用 pg_get_functiondef 取出目前的定義、換掉那一段再執行（create or replace 保留 grant）。
--     結尾檢查 public 裡已經沒有任何函式含 nccu，漏改就讓整個 migration 失敗。
-- (3) my_members() 不動：仍只信任 Google 登入（本機 test-login 旗標例外照舊）。

alter table members drop constraint members_email_check;
alter table members add constraint members_email_check
  check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

do $$
declare
  r record;
  d text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and position('nccu' in pg_get_functiondef(p.oid)) > 0
  loop
    d := pg_get_functiondef(r.oid);
    d := replace(d, $a$'^[^@\s]+@g\.nccu\.edu\.tw$'$a$, $b$'^[^@\s]+@[^@\s]+\.[^@\s]+$'$b$);
    d := replace(d, 'email 必須是 @g.nccu.edu.tw', 'email 格式不正確');
    execute d;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and position('nccu' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'open_login: 還有函式寫死 @g.nccu.edu.tw';
  end if;
end $$;
