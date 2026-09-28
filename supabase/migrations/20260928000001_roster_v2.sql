-- Adjustments Task 2：名單新欄位（學號、系級）與多列身份（同一個人可以同時是多組的專案生／
-- 也可以身兼幹部）。規格 §14 覆蓋掉原本「一個人只能屬於一組」的規則。
--
-- (1) members 加 student_id／dept_year，皆可為 null（舊資料相容：既有的列匯入時沒有這兩欄，
--     保持 null；管理員頁換組選單看到 null 學號要顯示「—」，是 UI 層的事，這裡只管 schema）。
alter table members add column student_id text;
alter table members add column dept_year text;

-- (2) 拿掉「一個 email 在一個學期只能有一列」的限制，改成「同一個人可以有多個身份列（不同角色
--     ／不同組別），但同一個身份（email＋role＋group）只能有一列」。用 coalesce 把 group_id 為
--     null（幹部）的情況也納入唯一性比較：postgres 的 unique 限制／唯一索引本來就把 null 視為
--     「彼此都不相等」，同一個人掛兩次「其他幹部」（group_id 都是 null）不會被擋下來，所以用一個
--     不可能真的出現的 sentinel uuid 取代 null 再比較。
alter table members drop constraint members_semester_id_email_key;
create unique index members_identity_key
  on members (semester_id, email, role, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- (3) groups.project_name 改為可為 null：專案名稱在 CSV 裡選填（同一組所有有填的列必須一致，
--     可以全部空白——parseRosterCsv 已經檢查過，import_roster 直接信任它）。
alter table groups alter column project_name drop not null;

-- (4) import_roster()：接受新欄位（studentId／deptYear／projectName 都可能是 null），維持原子
--     寫入。跟舊版一樣：只給 service_role 呼叫，函式本身用 p_ 前綴的參數名避開跟資料表欄位撞名
--     的 ambiguous 問題。
--
--     组別／專案名稱建立邏輯跟舊版的差異：舊版用 `distinct on (group)` 直接拿每組第一列的
--     project_name；新版允许同一組內有些列的專案名稱是 null、有些有填（parseRosterCsv 已經確保
--     「有填的列彼此一致」），所以改成「取這組所有列裡第一個非 null 的專案名稱」，整組都沒填就是
--     null。
create or replace function import_roster(p_semester_id uuid, rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row jsonb;
  v_group_id uuid;
  v_group_name text;
  v_project_name text;
begin
  -- 先建立所有組別（一組一列，project_name 取這組所有列裡第一個非 null 的值），每組建一條
  -- project 線。
  for v_group_name in
    select distinct r->>'group'
    from jsonb_array_elements(rows) r
    where r->>'role' = 'student'
  loop
    select r->>'projectName' into v_project_name
    from jsonb_array_elements(rows) r
    where r->>'role' = 'student' and r->>'group' = v_group_name and r->>'projectName' is not null
    limit 1;

    insert into groups (semester_id, name, project_name)
    values (p_semester_id, v_group_name, v_project_name)
    returning id into v_group_id;
    insert into lines (group_id, kind) values (v_group_id, 'project');
  end loop;

  -- 再建立所有成員（含 student_id／dept_year），幹部沒有組別，學生依組名找到剛剛建立的
  -- group_id。同一個人可以出現多次（不同角色／不同組別），members_identity_key 唯一索引
  -- 是最後一道防線。
  for row in select * from jsonb_array_elements(rows)
  loop
    insert into members (semester_id, email, name, role, student_id, dept_year, group_id)
    values (
      p_semester_id,
      row->>'email',
      row->>'name',
      (row->>'role')::role,
      row->>'studentId',
      row->>'deptYear',
      case when row->>'group' is not null
        then (select id from groups where semester_id = p_semester_id and name = row->>'group')
        else null
      end
    );
  end loop;
end;
$$;

revoke all on function import_roster(uuid, jsonb) from public, anon, authenticated;
grant execute on function import_roster(uuid, jsonb) to service_role;
