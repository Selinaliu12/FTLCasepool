-- Adjustments Task 4（規格 §14 第 5、6、7 點）：組別備註（「訂題後的主題」）。
--
-- 任一屬於該組的專案生身份都可以修改，記錄最後修改者姓名與時間；幹部、管理員、該組（任一身份）
-- 看得到，別組學生看不到。讀取權限沿用 groups／members 現有的 RLS（read_groups：is_staff() 或
-- id in my_groups()；read_members：is_staff() 或自己的列或 group_id in my_groups()）——這兩張表
-- 已經是「幹部看全部、學生看自己所有身份的組」，note 是 groups 的欄位，不需要另外開 policy。
--
-- 寫入：跟其他寫入動作一樣，只給 service_role 呼叫的 SECURITY DEFINER 函式；呼叫端
-- （src/server/actions/group-note.ts）先用目前身份（active identity）驗證是不是該組的專案生，
-- 再帶著已經驗證過的 group_id／note／更新者姓名呼叫這個函式，函式本身不重複判斷身份。
alter table groups add column note text;
alter table groups add column note_updated_by text;
alter table groups add column note_updated_at timestamptz;

create or replace function update_group_note(p_group_id uuid, p_note text, p_updated_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update groups
  set note = p_note,
      note_updated_by = p_updated_by,
      note_updated_at = now()
  where id = p_group_id;
end;
$$;

revoke all on function update_group_note(uuid, text, text) from public, anon, authenticated;
grant execute on function update_group_note(uuid, text, text) to service_role;
