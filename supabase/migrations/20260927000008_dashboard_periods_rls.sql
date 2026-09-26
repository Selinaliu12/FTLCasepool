-- Task 12（幹部總覽看板）發現的既有 RLS bug：read_periods 政策寫的是
-- `me() IS NOT NULL`，但 me() 回傳的是整列 members 這個 composite type。Postgres 對
-- composite value 的 IS NOT NULL 語意是「每一個欄位都不是 null 才算 true」；只要有任何一個
-- 欄位是 null，就算列本身存在，也回傳 false（既不是 IS NULL 也不是 IS NOT NULL，是第三種
-- 「混合」情況）。專案幹部／其他幹部的 group_id 依 schema 設計必定是 null
-- （check ((role = 'student') = (group_id is not null))），所以「所有幹部」呼叫 me() 都會
-- 回傳一個 group_id 是 null 的列，導致 `me() IS NOT NULL` 對幹部一律是 false——periods
-- 這張表對幹部從來就是空的，只是在 Task 12 之前沒有任何走使用者身分連線、需要幹部讀 periods
-- 的功能踩到這個地雷（學生會讀 periods，但學生的 group_id 一定有值，不受影響）。
--
-- 修法：判斷「有沒有找到人」只需要看 me() 回傳列的 id 欄位是不是 null（id 一定有值，是
-- primary key），不要對整個 composite 做 IS NOT NULL。
drop policy read_periods on periods;
create policy read_periods on periods for select using ((me()).id is not null);
