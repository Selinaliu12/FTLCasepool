-- Task 4 fix round 1 F6（controller ruling）。
--
-- update_group_note() 原本是靜默成功：如果 p_group_id 沒有對到任何一列（例如呼叫者的身份剛好
-- 在寫入的瞬間被移除、換組，或是理論上不該發生但萬一 access.active.groupId 指到一個不存在的
-- 組），UPDATE ... WHERE id = p_group_id 影響 0 列，函式照樣正常返回，呼叫端會看到「已更新組別
-- 備註」的成功提示，但資料庫其實什麼都沒變——把一個本該可見的錯誤（身份失效）吞成一個假的
-- 成功。改成用 GET DIAGNOSTICS 檢查影響列數，0 列就 raise exception，讓呼叫端
-- （src/server/actions/group-note.ts）能分辨「真的存了」跟「其實沒有這個組」，對到既有的
-- 「找不到」錯誤文案。
create or replace function update_group_note(p_group_id uuid, p_note text, p_updated_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update groups
  set note = p_note,
      note_updated_by = p_updated_by,
      note_updated_at = now()
  where id = p_group_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'group_not_found';
  end if;
end;
$$;

revoke all on function update_group_note(uuid, text, text) from public, anon, authenticated;
grant execute on function update_group_note(uuid, text, text) to service_role;
