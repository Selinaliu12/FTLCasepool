-- Task 5（規格 §16）：管理員新增單一成員＋軟移除（已離開）。
--
-- (1) members.left_at：null ＝ 這個身份還在；有值 ＝ 已離開（Task 7 的移除動作會填它）。
--     不刪列：已交的進度、比賽紀錄都用信箱／member id 指回這一列，名字要照常顯示。
--     members_identity_key 唯一索引不動——已離開的列仍然佔著它的身份（email＋role＋group），
--     之後「再新增同一個身份」就是把這一列恢復，而不是插第二列。
alter table members add column left_at timestamptz;

-- (2) 身份函式排除已離開的列。my_groups()／is_member()／is_staff()／is_pm()（以及建在它們上面的
--     can_read_content()／can_read_status()、所有 RLS policy）全部只透過 my_members() 取得
--     「呼叫者的身份」，所以只要 my_members() 排除 left_at 不是 null 的列，整條聯集就一起排除。
--     create or replace 保留原本的簽名、SECURITY DEFINER、search_path 與 grant（只給 authenticated）。
create or replace function my_members() returns setof members
language sql stable security definer set search_path = public as $$
  select m.* from members m join semesters s on s.id = m.semester_id
  where s.is_current
    and m.left_at is null
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
