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

-- (3) admin_add_member()：管理員新增一個人，或替已在名單上的人加一個身份（規格 §16 第 2、6 點）。
--     欄位格式（學校信箱、角色、專案生要有組別、幹部不能有組別）已經由應用程式的 validateMemberRow()
--     檢查過（跟名單 CSV 共用）；這裡在同一個交易裡做需要看資料庫的檢查與寫入：
--       - 組別必須屬於這個學期，而且這個學期是當前學期 → 否則「組別不屬於本學期」
--       - 同一信箱「還在」（left_at is null）的身份，姓名／學號／系級要一致（已離開的列不比）
--       - 同一個身份（email＋role＋組）已存在且沒離開 → 「這個人已經有這個身份」
--       - 同一個身份已存在但已離開 → 恢復那一列（清掉 left_at、更新姓名／學號／系級，id 不變）
--       - 都沒有 → 插入新的一列
--     同一個學期＋信箱用 advisory lock 排隊，兩個管理員同時新增同一個人不會繞過一致性檢查。
--     回傳 {id, restored}。只給 service_role（server action 先確認目前身份是管理員才呼叫）。
create or replace function admin_add_member(
  p_semester_id uuid,
  p_email text,
  p_name text,
  p_role role,
  p_student_id text,
  p_dept_year text,
  p_group_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing members%rowtype;
  v_id uuid;
begin
  if not exists (select 1 from semesters where id = p_semester_id and is_current) then
    raise exception '只能在本學期新增成員';
  end if;
  if (p_role = 'student') <> (p_group_id is not null) then
    raise exception '%', case when p_role = 'student' then '專案生要選組別' else '幹部不能填組別' end;
  end if;
  if p_group_id is not null
     and not exists (select 1 from groups where id = p_group_id and semester_id = p_semester_id) then
    raise exception '組別不屬於本學期';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin_add_member:' || p_semester_id::text || ':' || p_email));

  if exists (
    select 1 from members
    where semester_id = p_semester_id and email = p_email and left_at is null
      and (name is distinct from p_name
           or student_id is distinct from p_student_id
           or dept_year is distinct from p_dept_year)
  ) then
    raise exception '同一個信箱的姓名／學號／系級要一致';
  end if;

  select * into v_existing from members
  where semester_id = p_semester_id and email = p_email and role = p_role
    and coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  for update;

  if found then
    if v_existing.left_at is null then
      raise exception '這個人已經有這個身份';
    end if;
    update members
      set left_at = null, name = p_name, student_id = p_student_id, dept_year = p_dept_year
      where id = v_existing.id;
    return jsonb_build_object('id', v_existing.id, 'restored', true);
  end if;

  insert into members (semester_id, email, name, role, student_id, dept_year, group_id)
  values (p_semester_id, p_email, p_name, p_role, p_student_id, p_dept_year, p_group_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'restored', false);
exception
  when unique_violation then
    raise exception '這個人已經有這個身份';
end;
$$;

revoke all on function admin_add_member(uuid, text, text, role, text, text, uuid) from public, anon, authenticated;
grant execute on function admin_add_member(uuid, text, text, role, text, text, uuid) to service_role;
