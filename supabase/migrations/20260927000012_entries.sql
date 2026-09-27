-- Batch 2 Task 3：掛比賽、參賽成員、確認報名、取消報名。
--
-- competition_entries：一組把一場比賽「掛」到自己組的紀錄。同一組同一比賽同時只能有一筆
-- 「未退出」的（withdrawn_at is null）——用部分唯一索引擋，不是一般 unique：取消報名之後
-- 可以重新掛同一場，那時候會是另一筆新的 row，withdrawn_at is null 的部分索引不會撞到已經
-- 退出的舊紀錄。
create table competition_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  competition_id uuid not null references competitions on delete restrict,
  created_by text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  withdrawn_at timestamptz,
  result text check (result in ('advanced', 'awarded', 'not_selected'))
);
create unique index one_active_entry_per_group_competition
  on competition_entries (group_id, competition_id) where withdrawn_at is null;

-- entry_members：確認報名時勾選的參賽成員（必須是同一組的專案生，由 confirm_entry() 再驗一次）。
create table entry_members (
  entry_id uuid not null references competition_entries on delete cascade,
  member_id uuid not null references members on delete restrict,
  primary key (entry_id, member_id)
);

-- lines 加掛比賽線：確認報名時才會有這一列（entry_id not null）；project 線一律 entry_id
-- is null。unique index 保證同一筆報名最多對應一條線（確認報名只能建一次線）。
alter table lines add column entry_id uuid references competition_entries;
alter table lines add constraint lines_kind_entry_match
  check ((kind = 'competition') = (entry_id is not null));
create unique index one_line_per_entry on lines (entry_id) where entry_id is not null;

alter table competition_entries enable row level security;
alter table entry_members enable row level security;

-- 讀取（規格第 3 節）：所有幹部與自己組可讀；管理員如果自己在名單上沒有 member 列，
-- is_staff() 會是 false，跟 competitions 的 read policy 一樣走 server 端 service client
-- （見 src/server/queries/entries.ts），不依賴這裡的 RLS。沒有任何 insert/update/delete
-- 開放給 authenticated——寫入一律走 service client／confirm_entry()（service_role）。
grant select on competition_entries to authenticated;
grant select on entry_members to authenticated;

create policy read_entries on competition_entries for select to authenticated using (
  is_staff() or group_id = my_group()
);

create policy read_entry_members on entry_members for select to authenticated using (
  is_staff() or exists (
    select 1 from competition_entries ce where ce.id = entry_members.entry_id and ce.group_id = my_group()
  )
);

-- 確認報名：atomic（單一 RPC = 單一交易）。在 TS 端已經做過的檢查（報名截止日、報名成功、
-- 至少勾一人、成員是自己組的專案生）之上，這裡再原子地重新驗證一次——避免「檢查完、真的寫
-- 之前」的時間窗（例如兩個分開的請求同時確認同一筆報名，或成員在檢查之後被移出這組）。
-- 只給 service_role：呼叫者身分／權限（是不是這組的專案生）一律由 server action 在呼叫這個
-- 函式之前先檢查過。
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
    raise exception '參賽成員必須是同一組的專案生';
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
