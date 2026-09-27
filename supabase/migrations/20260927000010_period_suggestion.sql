-- Batch 2 Task 1：每期建議繳交內容。
--
-- periods 每一期可以各自填一段「建議繳交內容」（選填），沒填就不顯示。這段文字不影響繳交
-- 判定（不判逾期、不影響凍結規則），所以即使期別已經「凍結」（已有人交件，日期／編號不能
-- 改），管理員仍然可以隨時修改它的 suggestion。
alter table periods add column suggestion text;

-- save_periods() 整個函式重寫成接受 p_rows 裡每一列多一個 "suggestion" 欄位（可以沒有這個
-- key，等同 null）。空白字串／全空白存成 null，避免『交了一個只有空格的建議』這種沒意義的
-- 狀態。日期／編號的凍結規則跟 20260927000009_final_fixes.sql 完全一樣，只是比較 deadline
-- 相不相等時不再管 suggestion（凍結期別的 suggestion 允許改變，但 id／deadline／seq 仍要求
-- 原封不動地出現在輸入裡）。
drop function save_periods(uuid, jsonb);

create function save_periods(p_semester_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_frozen_seq int;
  v_last_frozen_deadline timestamptz;
  r record;
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

  select max(p.seq) into v_last_frozen_seq
  from periods p
  where p.semester_id = p_semester_id
    and exists (select 1 from progress_reports pr where pr.period_id = p.id);
  v_last_frozen_seq := coalesce(v_last_frozen_seq, 0);

  select deadline into v_last_frozen_deadline
  from periods where semester_id = p_semester_id and seq = v_last_frozen_seq;

  -- 凍結區（seq <= 最後凍結期）的每一期都必須原封不動（id／deadline）地出現在輸入裡；
  -- suggestion 不在這個比較裡，它可以自由改變。
  for r in
    select p.id, p.seq, p.deadline,
           exists (select 1 from progress_reports pr where pr.period_id = p.id) as has_reports
    from periods p
    where p.semester_id = p_semester_id and p.seq <= v_last_frozen_seq
    order by p.seq
  loop
    if not exists (
      select 1 from jsonb_array_elements(p_rows) e
      where (e->>'id')::uuid = r.id and (e->>'deadline')::timestamptz = r.deadline
    ) then
      if r.has_reports then
        raise exception '第 % 期已經有組別交了進度，不能修改或刪除', r.seq;
      else
        raise exception '第 % 期排在已有人交件的第 % 期之前，不能修改或刪除', r.seq, v_last_frozen_seq;
      end if;
    end if;
  end loop;

  -- 其他所有列（新增的、或凍結區之後的既有期別）都必須晚於最後一個凍結期別。
  if v_last_frozen_deadline is not null and exists (
    select 1 from jsonb_array_elements(p_rows) e
    where (e->>'deadline')::timestamptz <= v_last_frozen_deadline
      and not exists (
        select 1 from periods p
        where p.id = (e->>'id')::uuid and p.semester_id = p_semester_id and p.seq <= v_last_frozen_seq
      )
  ) then
    raise exception '新的截止時間必須晚於已有人交件的第 % 期', v_last_frozen_seq;
  end if;

  -- 刪掉凍結區之後、沒出現在輸入裡的期別（都沒人交過；真的有的話 on delete restrict 會擋）。
  delete from periods p
  where p.semester_id = p_semester_id
    and p.seq > v_last_frozen_seq
    and not exists (select 1 from jsonb_array_elements(p_rows) e where (e->>'id')::uuid = p.id);

  -- 凍結區的 suggestion 先更新（不動 seq／deadline）。
  update periods p
  set suggestion = nullif(trim(e->>'suggestion'), '')
  from jsonb_array_elements(p_rows) e
  where p.semester_id = p_semester_id and p.seq <= v_last_frozen_seq and (e->>'id')::uuid = p.id;

  -- 凍結區之後的期別先搬到負數編號，避開 unique (semester_id, seq)，再依截止時間重新編號。
  update periods set seq = -seq where semester_id = p_semester_id and seq > v_last_frozen_seq;

  update periods p
  set deadline = (e->>'deadline')::timestamptz,
      suggestion = nullif(trim(e->>'suggestion'), '')
  from jsonb_array_elements(p_rows) e
  where p.semester_id = p_semester_id and p.seq < 0 and (e->>'id')::uuid = p.id;

  insert into periods (semester_id, seq, deadline, suggestion)
  select p_semester_id, -1000000 - t.ord::int, (t.e->>'deadline')::timestamptz, nullif(trim(t.e->>'suggestion'), '')
  from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
  where t.e->>'id' is null;

  update periods p
  set seq = v_last_frozen_seq + x.rn
  from (
    select id, row_number() over (order by deadline) as rn
    from periods where semester_id = p_semester_id and seq < 0
  ) x
  where p.id = x.id;
end;
$$;

revoke all on function save_periods(uuid, jsonb) from public, anon, authenticated;
grant execute on function save_periods(uuid, jsonb) to service_role;
