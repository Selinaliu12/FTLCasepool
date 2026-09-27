-- Adjustments Task 3：多重身份的存取模型（規格 §14 第 2、3 點）。
--
-- Task 2 拿掉了「一個信箱一學期只能一列」，同一個人可以同時是多組的專案生、也可以兼幹部。
-- 原本所有 RLS 都建立在 me()（`limit 1`，只挑一列）上：
--   - my_group()   = (me()).group_id       → 多組專案生只看得到「剛好被挑到的那一組」
--   - is_staff()   = (me()).role in (...)  → 學生列排在前面的幹部被當成學生
--   - is_pm()      = (me()).role = 'pm'
-- 規則改成：資料庫讀取權限＝使用者「所有身份」的聯集；寫入／動作由應用程式依「目前身份」判斷。
--
-- 做法：
--   (1) my_members()：目前登入者在當前學期的所有名單列（沿用 me() 的「只信任 google／本機開關」
--       規則）。SECURITY DEFINER 才能繞過 members 自己的 RLS（不然 read_members 會遞迴）。
--   (2) my_groups()：所有「專案生」身份的組 id 集合。
--   (3) is_member()：有任何一列身份（取代 `(me()).id is not null`）。
--   (4) is_staff()／is_pm()：任一身份是幹部／專案幹部。
--   (5) 所有 `= my_group()` 的 policy／函式改成 `in (select my_groups())`，`(me()).…` 的地方改用
--       is_member()／my_members()。視圖 line_light_events／stage_status 本身只呼叫
--       can_read_status()，改 can_read_status() 就一起跟著變，不必重建視圖。
--   (6) 最後 drop 掉 me() 與 my_group()：已經沒有任何 policy／視圖／函式用它們，留著只會讓之後
--       有人又寫出「只看一列」的權限判斷。drop function 如果還有 policy 依賴會直接失敗，等於在
--       migration 裡再驗證一次「全部都換掉了」。
--
-- 專案幹部負責的組別照舊掛在 pm_assignments（pm 那一列的 member id），這份 migration 不動。

create or replace function my_members() returns setof members
language sql stable security definer set search_path = public as $$
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
$$;

create or replace function my_groups() returns setof uuid
language sql stable security definer set search_path = public as $$
  select group_id from my_members() where role = 'student' and group_id is not null
$$;

create or replace function is_member() returns boolean
language sql stable as $$
  select exists (select 1 from my_members())
$$;

create or replace function is_staff() returns boolean
language sql stable as $$
  select exists (select 1 from my_members() where role in ('pm', 'officer'))
$$;

create or replace function is_pm() returns boolean
language sql stable as $$
  select exists (select 1 from my_members() where role = 'pm')
$$;

create or replace function can_read_content(l uuid) returns boolean
language sql stable as $$
  select is_pm() or line_group(l) in (select my_groups())
$$;

create or replace function can_read_status(l uuid) returns boolean
language sql stable as $$
  select is_staff() or line_group(l) in (select my_groups())
$$;

-- 權限：RLS 政策以 authenticated 身分評估，所以只開給 authenticated；PUBLIC／anon 一律收掉。
revoke all on function my_members() from public, anon;
revoke all on function my_groups() from public, anon;
revoke all on function is_member() from public, anon;
revoke all on function is_staff() from public, anon;
revoke all on function is_pm() from public, anon;
revoke all on function can_read_content(uuid) from public, anon;
revoke all on function can_read_status(uuid) from public, anon;
grant execute on function my_members() to authenticated;
grant execute on function my_groups() to authenticated;
grant execute on function is_member() to authenticated;
grant execute on function is_staff() to authenticated;
grant execute on function is_pm() to authenticated;
grant execute on function can_read_content(uuid) to authenticated;
grant execute on function can_read_status(uuid) to authenticated;

-- policy：同名 drop + create，統一 for select to authenticated（anon 本來就沒有資料表權限）。
drop policy if exists read_groups on groups;
create policy read_groups on groups for select to authenticated using (
  is_staff() or id in (select my_groups())
);

drop policy if exists read_periods on periods;
create policy read_periods on periods for select to authenticated using (is_member());

-- 原本是 `email = (me()).email`：自己的所有名單列（不限學期，跟原本一樣只比 email）。
drop policy if exists read_members on members;
create policy read_members on members for select to authenticated using (
  is_staff()
  or exists (select 1 from my_members() mm where mm.email = members.email)
  or group_id in (select my_groups())
);

drop policy if exists read_pm on pm_assignments;
create policy read_pm on pm_assignments for select to authenticated using (
  is_staff() or group_id in (select my_groups())
);

drop policy if exists read_competitions on competitions;
create policy read_competitions on competitions for select to authenticated using (
  semester_id = (select id from semesters where is_current limit 1)
  and ((status = 'published' and is_member()) or is_staff())
);

drop policy if exists read_entries on competition_entries;
create policy read_entries on competition_entries for select to authenticated using (
  (is_staff() or group_id in (select my_groups()))
  and exists (
    select 1 from groups g
    where g.id = competition_entries.group_id
      and g.semester_id = (select id from semesters where is_current limit 1)
  )
);

drop policy if exists read_entry_members on entry_members;
create policy read_entry_members on entry_members for select to authenticated using (
  exists (
    select 1
    from competition_entries ce
    join groups g on g.id = ce.group_id
    where ce.id = entry_members.entry_id
      and g.semester_id = (select id from semesters where is_current limit 1)
      and (is_staff() or ce.group_id in (select my_groups()))
  )
);

-- read_reports／read_checkins／read_stage_submissions／read_lines 以及視圖 line_light_events、
-- stage_status 只透過 can_read_content()／can_read_status() 判斷，上面改完函式就跟著變成聯集。

drop function my_group();
drop function me();
