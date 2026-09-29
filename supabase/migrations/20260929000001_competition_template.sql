-- 競賽大廳新模板 Task 1：新增選填欄位（規格第 15 節）。全部選填、空白存 null；既有卡片
-- 這些欄位全是 null，大廳與詳細頁之後（Task 3、4）要處理「沒有內容的區塊整個不顯示」。
--
-- 這張表已經 enable row level security、也已經 grant select on competitions to authenticated
-- （見 20260927000011_competitions.sql）；新增欄位沿用同一張表的既有 grant／policy，不需要
-- 另外補（批次 2 收緊的「新表或新函式要自己 grant」不適用於既有表的加欄位）。
alter table competitions
  add column summary text,
  add column tags text[] not null default '{}',
  add column max_prize integer,
  add column perks text,
  add column info_session_at timestamptz,
  add column signup_note text,
  add column submission_note text,
  add column final_note text,
  add column final_format text,
  add column fee text,
  add column documents text,
  add column skills text,
  add column recommended boolean not null default false,
  add column staff_note text;

-- 最高獎金：0 到 100,000,000 的整數（新台幣），非整數或負數在應用層擋（domain
-- validateCompetition），這裡是最後一道防線。
alter table competitions
  add constraint competitions_max_prize_range check (max_prize is null or (max_prize between 0 and 100000000));

-- 比賽類型標籤只能是這 7 個（規格第 15 節 #4）；DB 層也要擋，不能只靠應用層
-- （Review Focus：用 service client 直接 insert 一個不在清單內的標籤要噴錯，見整合測試）。
alter table competitions
  add constraint competitions_tags_valid check (
    tags <@ array['企業出題', '企劃提案', '創業', '金融科技', 'ESG', '行銷', '數據分析']::text[]
  );
