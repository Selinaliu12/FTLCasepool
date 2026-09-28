-- Adjustments Task 5（規格 §14 第 8 點）：管理員可以自由修改、刪除任何一期。
--
-- 批次 1 最終審查 #2 的「已有人交件的期別（與排在它之前的期別）凍結」規則整個拿掉：
--   - 任何一期都可以改截止日（包含已經有人交件的期別）。準時與否沒有存成欄位，一律由
--     「繳交時間 vs 期別截止日」即時算出來，所以改了日期之後準時率自然依新日期重算。
--   - 任何一期都可以刪除。被刪的期別如果有 progress_reports，呼叫端必須帶
--     p_confirm_delete_with_reports = true（管理員在畫面上打字確認過），否則丟
--     '這期已經有組別交了進度，要刪除請先確認'，什麼都不動。
--   - 期別一律依截止日期重新編號（沿用負數暫存編號法避開 unique (semester_id, seq)）；
--     建議內容（suggestion）是期別這一列的欄位，重新編號時跟著期別走。
--
-- 回傳值：被刪掉的 progress_reports 的 pdf_key 陣列。R2 物件不在資料庫交易裡，呼叫端要等這個
-- RPC（＝一個交易）成功 commit 之後才去刪 R2 物件；刪 R2 失敗只記 log（孤兒檔案由批次 3 的
-- 清掃處理），不影響已經 commit 的資料。
--
-- progress_reports 沒有任何子表用外鍵參照它（upload_tickets 只是用 key 字串記錄「這把 key
-- 已經用掉」，不是外鍵；留著已用掉的票沒有副作用，反而讓那把 key 不能被重新申請），所以刪進度
-- 不需要再連帶刪其他列。

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 鎖定觸發器：只在「交易內」設了 app.allow_admin_period_delete = 'on' 時放行 DELETE
-- ─────────────────────────────────────────────────────────────────────────────
-- 這個旗標只由 save_periods() 在刪除分支裡用 set_config(..., true)（交易內有效）打開，刪完馬上
-- 關掉。它不會變成一般使用者的後門：
--   - anon／authenticated 對 progress_reports 沒有 delete 權限（20260927000002 收回了直接寫表），
--     就算自己設了這個旗標，delete 在權限檢查就被拒，根本走不到觸發器。
--   - 會設旗標的 save_periods() 只 grant 給 service_role。
--   - 只放行 DELETE；UPDATE（改燈號、三句話、換 PDF）一律照舊 2 小時鎖定。
--   - 學生撤回（withdrawProgress）是另一個交易，旗標不存在，已鎖定的進度照樣被擋。
create or replace function reject_if_locked() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_admin_period_delete', true) = 'on' then
    return old;
  end if;
  if now() >= old.pdf_uploaded_at + interval '2 hours' then
    raise exception 'LOCKED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

revoke all on function reject_if_locked() from public, anon, authenticated;
grant execute on function reject_if_locked() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. save_periods：自由修改／刪除＋依日期重新編號
-- ─────────────────────────────────────────────────────────────────────────────
-- 輸入 p_rows 跟之前一樣：jsonb 陣列 [{ id: uuid | null, deadline: timestamptz, suggestion?: text }]；
-- 有 id 的是既有期別（保留／修改），id 為 null 的是新增，既有期別沒出現在陣列裡＝刪除。
-- 函式一開始對這學期所有期別下 FOR UPDATE 列鎖：學生送出進度時 insert progress_reports 會對被參照
-- 的 periods 列拿 FOR KEY SHARE，跟 FOR UPDATE 互斥，所以「數被刪期別有幾份進度」到「真的刪掉」
-- 之間不會有人插隊交件（插隊的話會等這個交易結束，之後參照的期別已經不在，insert 失敗）。
drop function save_periods(uuid, jsonb);

create function save_periods(p_semester_id uuid, p_rows jsonb, p_confirm_delete_with_reports boolean default false)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_ids uuid[];
  v_pdf_keys text[];
begin
  perform 1 from periods where semester_id = p_semester_id for update;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where e->>'id' is not null
      and not exists (select 1 from periods p where p.id = (e->>'id')::uuid and p.semester_id = p_semester_id)
  ) then
    raise exception '期別不屬於本學期';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    group by (e->>'deadline')::timestamptz having count(*) > 1
  ) then
    raise exception '截止時間不能重複';
  end if;

  select coalesce(array_agg(p.id), '{}') into v_deleted_ids
  from periods p
  where p.semester_id = p_semester_id
    and not exists (select 1 from jsonb_array_elements(p_rows) e where (e->>'id')::uuid = p.id);

  select coalesce(array_agg(pr.pdf_key), '{}') into v_pdf_keys
  from progress_reports pr
  where pr.period_id = any (v_deleted_ids);

  if cardinality(v_pdf_keys) > 0 then
    if not coalesce(p_confirm_delete_with_reports, false) then
      raise exception '這期已經有組別交了進度，要刪除請先確認';
    end if;
    -- 只有這一段放行鎖定觸發器：刪掉被刪期別底下的進度（包含已鎖定的），刪完立刻關掉旗標。
    perform set_config('app.allow_admin_period_delete', 'on', true);
    delete from progress_reports where period_id = any (v_deleted_ids);
    perform set_config('app.allow_admin_period_delete', 'off', true);
  end if;

  delete from periods where id = any (v_deleted_ids);

  -- 全部期別先搬到負數編號，避開 unique (semester_id, seq)，再依截止時間重新編號。
  update periods set seq = -seq where semester_id = p_semester_id and seq > 0;

  update periods p
  set deadline = (e->>'deadline')::timestamptz,
      suggestion = nullif(trim(e->>'suggestion'), '')
  from jsonb_array_elements(p_rows) e
  where p.semester_id = p_semester_id and (e->>'id')::uuid = p.id;

  insert into periods (semester_id, seq, deadline, suggestion)
  select p_semester_id, -1000000 - t.ord::int, (t.e->>'deadline')::timestamptz, nullif(trim(t.e->>'suggestion'), '')
  from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
  where t.e->>'id' is null;

  update periods p
  set seq = x.rn
  from (
    select id, row_number() over (order by deadline) as rn
    from periods where semester_id = p_semester_id
  ) x
  where p.id = x.id;

  return v_pdf_keys;
end;
$$;

revoke all on function save_periods(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function save_periods(uuid, jsonb, boolean) to service_role;
