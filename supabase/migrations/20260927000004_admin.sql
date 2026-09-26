-- Task 5：管理員動作需要的資料庫端支援。
--
-- import_roster(semester_id, rows)：把已經通過 parseRosterCsv() 驗證的名單，在單一交易裡
-- 建立 groups／lines（每組一條 project 線）／members。任何一列失敗（例如組別名稱在這個學期
-- 已存在）整批回滾，不會留下部分匯入的髒資料。
--
-- 這個函式只給伺服器的服務身分（service_role）呼叫：管理員動作一律先用
-- src/server/actions/admin.ts 的 requireAdmin() 檔在應用層，這裡再收回
-- public/anon/authenticated 的執行權限做防禦縱深（跟前面幾份 migration 的原則一致）。
--
-- 參數名故意叫 p_semester_id（不是 semester_id）：plpgsql 裡如果參數名跟資料表的欄位名
-- 撞名，bare 欄位參照（例如 WHERE semester_id = ...）會直接噴「column reference is
-- ambiguous」，而不是照直覺去比對最近的作用域。
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
  -- 先建立所有組別（一列 = 一組別＋專案名稱），每組建一條 project 線。
  for row in
    select distinct on (r->>'group') r
    from jsonb_array_elements(rows) r
    where r->>'role' = 'student'
  loop
    v_group_name := row->>'group';
    v_project_name := row->>'projectName';
    insert into groups (semester_id, name, project_name)
    values (p_semester_id, v_group_name, v_project_name)
    returning id into v_group_id;
    insert into lines (group_id, kind) values (v_group_id, 'project');
  end loop;

  -- 再建立所有成員，幹部沒有組別，學生依組名找到剛剛建立的 group_id。
  for row in select * from jsonb_array_elements(rows)
  loop
    insert into members (semester_id, email, name, role, group_id)
    values (
      p_semester_id,
      row->>'email',
      row->>'name',
      (row->>'role')::role,
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
