-- Batch 2 Task 3 fix round 1.
--
-- Controller ruling：確認報名這件事，就算已經過了報名截止日還是允許——組上可能已經在比賽官方
-- 管道報名成功，只是這裡的「確認」動作比較晚做。20260927000011_competitions.sql／
-- 20260927000012_entries.sql 都不套用、也從來沒套用過報名截止日檢查在 confirm_entry() 這一層
-- （報名截止日只擋 attachCompetition()／掛比賽那一步，見 src/server/actions/entries.ts）。
-- 000012 第 54 行的註解「在 TS 端已經做過的檢查（報名截止日、...）」容易被誤讀成
-- confirm_entry() 依賴一個「TS 端先擋過期」的前提——這裡不改已經套用過的 migration 檔案，只在
-- 這份新 migration 把這件事寫清楚：confirm_entry()／update_entry_members() 都不檢查、也不該
-- 檢查報名截止日。
--
-- 規格「確認後不能再改參賽成員以外的設定」表示參賽成員本身在確認之後還是可以改的，只要這筆
-- 報名還沒退出。原本 setEntryMembers() 在確認後直接拒絕（誤把「參賽成員」當成「參賽成員以外
-- 的設定」），這裡修正：新增 update_entry_members()，語意跟 confirm_entry() 對參賽成員的檢查
-- 一致（鎖定這筆報名、確認還沒退出、至少一人、全部都是這組的專案生），差別只在於它不要求
-- 「還沒確認過」——確認前後都可以呼叫。同時把「成員不是這組的專案生」的錯誤訊息統一成
-- 「只能勾選自己組的專案生」（原本 confirm_entry() 用的「參賽成員必須是同一組的專案生」語意
-- 一樣但文字不一致，這裡用 create or replace 讓兩個函式共用同一句話）。
create or replace function confirm_entry(p_entry_id uuid, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_confirmed_at timestamptz;
  v_withdrawn_at timestamptz;
  v_distinct_ids uuid[];
  v_valid_count int;
  v_line_id uuid;
begin
  select group_id, confirmed_at, withdrawn_at into v_group_id, v_confirmed_at, v_withdrawn_at
  from competition_entries where id = p_entry_id
  for update;

  if v_group_id is null then
    raise exception '找不到這筆報名';
  end if;
  if v_confirmed_at is not null then
    raise exception '這筆報名已經確認過了';
  end if;
  if v_withdrawn_at is not null then
    raise exception '這筆報名已經退出';
  end if;

  select array_agg(distinct m) into v_distinct_ids from unnest(p_member_ids) as m;
  if v_distinct_ids is null or array_length(v_distinct_ids, 1) = 0 then
    raise exception '請至少勾選一位參賽成員';
  end if;

  select count(*) into v_valid_count
  from members
  where id = any(v_distinct_ids) and role = 'student' and group_id = v_group_id;

  if v_valid_count <> array_length(v_distinct_ids, 1) then
    raise exception '只能勾選自己組的專案生';
  end if;

  delete from entry_members where entry_id = p_entry_id;
  insert into entry_members (entry_id, member_id)
  select p_entry_id, m from unnest(v_distinct_ids) as m;

  update competition_entries set confirmed_at = now() where id = p_entry_id;

  insert into lines (group_id, kind, entry_id)
  values (v_group_id, 'competition', p_entry_id)
  returning id into v_line_id;

  return v_line_id;
end;
$$;

revoke all on function confirm_entry(uuid, uuid[]) from public, anon, authenticated;
grant execute on function confirm_entry(uuid, uuid[]) to service_role;

-- 改參賽成員（確認前後都可以，只要這筆報名還沒退出）。跟 confirm_entry() 同一套規矩：atomic、
-- SECURITY DEFINER、service_role 專用、search_path 固定。不動 confirmed_at／lines，只換
-- entry_members。
create or replace function update_entry_members(p_entry_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_withdrawn_at timestamptz;
  v_distinct_ids uuid[];
  v_valid_count int;
begin
  select group_id, withdrawn_at into v_group_id, v_withdrawn_at
  from competition_entries where id = p_entry_id
  for update;

  if v_group_id is null then
    raise exception '找不到這筆報名';
  end if;
  if v_withdrawn_at is not null then
    raise exception '這筆報名已經退出';
  end if;

  select array_agg(distinct m) into v_distinct_ids from unnest(p_member_ids) as m;
  if v_distinct_ids is null or array_length(v_distinct_ids, 1) = 0 then
    raise exception '請至少勾選一位參賽成員';
  end if;

  select count(*) into v_valid_count
  from members
  where id = any(v_distinct_ids) and role = 'student' and group_id = v_group_id;

  if v_valid_count <> array_length(v_distinct_ids, 1) then
    raise exception '只能勾選自己組的專案生';
  end if;

  delete from entry_members where entry_id = p_entry_id;
  insert into entry_members (entry_id, member_id)
  select p_entry_id, m from unnest(v_distinct_ids) as m;
end;
$$;

revoke all on function update_entry_members(uuid, uuid[]) from public, anon, authenticated;
grant execute on function update_entry_members(uuid, uuid[]) to service_role;
