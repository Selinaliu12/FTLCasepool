-- 最終整體審查的修正（batch 1 final review）。
--
-- ─────────────────────────────────────────────────────────────────────────────
-- #1 函式的 EXECUTE 預設權限真的從 PUBLIC 收回來
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260927000003_default_privileges.sql 寫的是
--   alter default privileges for role postgres in schema public revoke all on functions from ... public;
-- 但 Postgres 的「per-schema」預設權限只能在全域預設之上「再加」權限，收不掉全域預設。
-- 函式的全域預設（沒有任何 pg_default_acl 設定時）就是 PUBLIC 有 EXECUTE，所以那一行對 PUBLIC
-- 是 no-op：之後新建的函式（例如 reject_if_locked()）一樣自動開給 PUBLIC，而 anon／authenticated
-- 都是 PUBLIC 的成員，等於沒收。
--
-- 正確做法是不寫 `in schema`，直接改 postgres 角色的「全域」預設權限。
alter default privileges for role postgres revoke execute on functions from public;

-- 已經存在、而且 PUBLIC 還有 EXECUTE 的函式，逐一收回（用 catalog 查過：
-- reject_if_locked、my_group、is_staff、is_pm、can_read_content、can_read_status）。
--
-- reject_if_locked() 是 trigger 函式：trigger 觸發時不檢查呼叫者的 EXECUTE 權限，收回不影響
-- progress_lock trigger 的運作。
revoke execute on function reject_if_locked() from public;

-- 下面五個是 RLS 政策裡會呼叫到的輔助函式。RLS 政策以「查詢者」身分執行函式，登入的人
-- （authenticated）一定要保留 EXECUTE；anon 已經沒有任何資料表權限（20260927000002），
-- RLS 政策根本不會以 anon 身分被評估，所以跟 me()／line_group() 一樣收掉 PUBLIC 與 anon。
revoke execute on function my_group() from public, anon;
revoke execute on function is_staff() from public, anon;
revoke execute on function is_pm() from public, anon;
revoke execute on function can_read_content(uuid) from public, anon;
revoke execute on function can_read_status(uuid) from public, anon;
grant execute on function my_group() to authenticated;
grant execute on function is_staff() to authenticated;
grant execute on function is_pm() to authenticated;
grant execute on function can_read_content(uuid) to authenticated;
grant execute on function can_read_status(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- #2 期別表不再「第一份進度交出去就整張凍結」
-- ─────────────────────────────────────────────────────────────────────────────
-- 舊版 save_periods() 只要這學期任何一期有人交過進度，整張期別表就不能再改（連追加下一期都不行），
-- 學期中根本沒辦法補填後面的期別。新規則：
--   - 已經有 progress_reports 的期別＝「凍結」：截止時間與編號都不能改、不能刪。
--   - 編號排在最後一個凍結期別之前的期別也一起鎖住（改它或刪它都會讓凍結期別的編號位移）。
--   - 其他（最後一個凍結期別之後的）期別可以改、可以刪；也可以追加新的期別。
--   - 所有沒凍結的截止時間都必須「嚴格晚於」最後一個凍結期別的截止時間——依截止時間重新編號時，
--     凍結期別的 seq 才永遠不會位移（學生交件、看板、準時率都用 seq／period_id 對期別）。
--
-- 輸入改成 jsonb 陣列 [{ id: uuid | null, deadline: timestamptz }]：有 id 的是既有期別（保留／修改），
-- id 為 null 的是新增，既有期別沒出現在陣列裡＝刪除。
-- 整個函式是一個 RPC＝一個 statement，Postgres 自動包成單一交易；函式一開始先對這學期所有期別
-- 下 FOR UPDATE 列鎖：學生送出進度時 insert progress_reports 會對被參照的 periods 列拿
-- FOR KEY SHARE，跟 FOR UPDATE 互斥，所以「檢查哪些期別已凍結」到「改寫期別」之間不會有人插隊交件。
-- 萬一真的有漏網之魚，下面把 progress_reports.period_id 改成 on delete restrict，資料庫層也會擋住
-- 「刪掉有進度的期別」，不會再像舊版 on delete cascade 那樣把學生的進度一起刪掉。

alter table progress_reports drop constraint progress_reports_period_id_fkey;
alter table progress_reports
  add constraint progress_reports_period_id_fkey
  foreign key (period_id) references periods (id) on delete restrict;

drop function save_periods(uuid, timestamptz[]);

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

  -- 凍結區（seq <= 最後凍結期）的每一期都必須原封不動地出現在輸入裡。
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

  -- 凍結區之後的期別先搬到負數編號，避開 unique (semester_id, seq)，再依截止時間重新編號。
  update periods set seq = -seq where semester_id = p_semester_id and seq > v_last_frozen_seq;

  update periods p
  set deadline = (e->>'deadline')::timestamptz
  from jsonb_array_elements(p_rows) e
  where p.semester_id = p_semester_id and p.seq < 0 and (e->>'id')::uuid = p.id;

  insert into periods (semester_id, seq, deadline)
  select p_semester_id, -1000000 - t.ord::int, (t.e->>'deadline')::timestamptz
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
