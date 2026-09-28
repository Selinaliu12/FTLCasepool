-- Adjustments Task 5 fix round 1（F2）：save_periods() 多收一個 p_expected_report_counts
-- （jsonb：{ "<period_id>": <交件數> }），是管理員在確認視窗看到的每一期交件數。帶了確認旗標時，
-- 在同一個交易裡（期別已經 FOR UPDATE 鎖住，學生交件的 insert 會被擋在外面）逐期比對「實際交件數」
-- 跟這份數字；任何一期對不上（或根本沒帶）就丟 '交件狀況已變動，請重新確認'，什麼都不動，畫面
-- 重新預覽一次。其餘行為跟 20260928000005_periods_free_edit.sql 完全一樣；reject_if_locked() 不變。
drop function save_periods(uuid, jsonb, boolean);

create function save_periods(
  p_semester_id uuid,
  p_rows jsonb,
  p_confirm_delete_with_reports boolean default false,
  p_expected_report_counts jsonb default null
)
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

  if cardinality(v_pdf_keys) > 0 and not coalesce(p_confirm_delete_with_reports, false) then
    raise exception '這期已經有組別交了進度，要刪除請先確認';
  end if;

  -- 確認過的刪除：每一期實際的交件數必須跟管理員在確認視窗看到的一樣（沒帶數字＝對不上）。
  -- 預覽之後才交進來的進度不會在管理員沒看到的情況下被一起刪掉。
  if coalesce(p_confirm_delete_with_reports, false) and (
    p_expected_report_counts is null
    or exists (
      select 1
      from unnest(v_deleted_ids) as d(id)
      where (select count(*) from progress_reports pr where pr.period_id = d.id)
            <> coalesce((p_expected_report_counts ->> d.id::text)::int, 0)
    )
  ) then
    raise exception '交件狀況已變動，請重新確認';
  end if;

  if cardinality(v_pdf_keys) > 0 then
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

revoke all on function save_periods(uuid, jsonb, boolean, jsonb) from public, anon, authenticated;
grant execute on function save_periods(uuid, jsonb, boolean, jsonb) to service_role;
