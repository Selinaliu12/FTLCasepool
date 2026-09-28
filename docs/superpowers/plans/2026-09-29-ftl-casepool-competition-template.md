# FTL 競賽池 競賽大廳新模板 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. TDD 垂直切片（一個失敗測試 → 紅 → 最少實作 → 綠）；權限測試要做「故意放寬 → 紅」的突變檢查；畫面 Task 收尾截 1280×800 與 375×812 兩輪存 `.screenshots/round{1,2}-tpl-*`。

**Goal:** 依規格第 15 節，讓競賽卡片多出專案生決定要不要參加所需的資訊（類型、獎金、各階段要交什麼、報名費、幹部推薦等），大廳卡片改成一眼判斷，新增詳細頁，並讓每組看得到別組掛了哪些比賽。

**Architecture:** `competitions` 表加 12 個選填欄位，沿用現有的「幹部用 server action → service_role 寫入」路徑與同一套表單。「已掛上的組別」不放寬 `competition_entries` 的 RLS（它還帶著確認時間、退出時間等），改用一個 SECURITY DEFINER 函式只回傳「比賽 id＋組名」。詳細頁 `/competitions/[id]` 是新頁面，讀取權限跟大廳相同。

**Tech Stack:** Next.js 15 App Router、Supabase Postgres＋RLS、shadcn/ui、Vitest、Playwright（同前幾批）。

**Spec:** `docs/superpowers/specs/2026-09-26-ftl-casepool-design.md` 第 15 節（優先於第 4.8、13、14 節）。

## Global Constraints

- 批次 1、2 與第 14 節調整的 Global Constraints 全部適用（見前三份計畫）。
- 必填維持：名稱、官方連結（http/https）、報名截止日時。其他新欄位全部選填，空白存成 null。
- 比賽類型標籤只能是這 7 個，可多選、順序依此清單：`企業出題`、`企劃提案`、`創業`、`金融科技`、`ESG`、`行銷`、`數據分析`。
- 最高獎金：0 到 100,000,000 的整數（新台幣），顯示 `NT$100,000`；非整數或負數 → `最高獎金請填整數金額`。
- 字數上限：一句話介紹 80 字（超過 → `一句話介紹最多 80 字`）；其他文字欄位 500 字（超過 → `{欄位名}最多 500 字`）。字數以 Unicode 字元計，先去頭尾空白。
- 說明會時間與其他日期同樣是台北時間、日期＋時間兩格，預設 23:59。
- 「已掛上的組別」＝該比賽在本學期、狀態不是「已退出」的報名；得獎、未入選的仍列出。只回傳組名，依組名自然排序（第2組在第10組前）。草稿比賽不列。
- 卡片的「賽制」＝有填日期的階段依 報名 → 繳件 → 決賽 串起來，例如 `報名 → 決賽`。
- 詳細頁：已發布的比賽名單上所有人都能看；草稿只有幹部與管理員；其他情況一律回找不到頁面（跟現有 404 一致）。
- 新表或新函式：預設權限已收緊，要自己 grant；SECURITY DEFINER 一律 `set search_path = public`。
- Migration 檔名從 `20260929000001_` 開始。

## Review Focus

1. **舊比賽沒有新欄位**：批次 2 建的卡片新欄位全是 null，大廳與詳細頁不能壞、不能出現空標題或「null」，沒有內容的區塊整個不顯示。
2. **已掛上組別的權限**：學生看得到別組**組名**，但透過任何查詢都拿不到別組的參賽成員、確認時間、階段檔案、評語（RLS 測試＋突變檢查）。
3. **退出後又重新掛**：同一組退出後重掛，組名只出現一次。
4. **長文字**：幹部備註或要交什麼貼了很長的網址或換行，手機 375 寬不能橫向捲動，換行要保留。
5. **草稿詳細頁**：學生直接打草稿的網址要看到找不到頁面，不能看到內容。

---

## Task 1：新欄位進資料庫與表單

**Files:** `supabase/migrations/20260929000001_competition_template.sql`、`src/domain/competition.ts`、`src/app/(app)/competitions/competition-form.tsx`、`competition-form-defaults.ts`、`src/server/actions/competitions.ts`、`src/server/queries/competitions.ts`（讀出新欄位）。

**先寫的測試：**
- 單元（`src/domain/competition.test.ts`）：
  - 標籤不在清單內 → 拒絕；
  - 標籤重複 → 去重並依清單排序；
  - 最高獎金 `1.5`、`-1`、`abc` → `最高獎金請填整數金額`，空白 → null；
  - 一句話 81 字 → 錯誤，80 字 → 通過；
  - 備註 501 字 → 錯誤；
  - 空白字串一律變 null。
- 整合（`tests/integration/competitions.test.ts` 追加）：
  - 幹部建立含全部新欄位的比賽，讀回來值相同；
  - 更新時把欄位清空會存成 null；
  - 學生呼叫 `createCompetition` 仍被拒（沿用）。
- 元件（`competition-form.test.tsx`）：
  - 7 個標籤可多選；
  - 幹部推薦是開關；
  - 說明會有日期＋時間兩格；
  - 字數超過時錯誤訊息出現在該欄下方。

**實作：**
- Migration：`competitions` 加
  - `summary text`、`tags text[] not null default '{}'`（check 每個元素都在清單內）、`max_prize integer check (max_prize between 0 and 100000000)`、`perks text`、`info_session_at timestamptz`；
  - `signup_note text`、`submission_note text`、`final_note text`、`final_format text`；
  - `fee text`、`documents text`、`skills text`、`recommended boolean not null default false`、`staff_note text`。
- 表單分成五區，順序同詳細頁：基本資料、參賽資格、賽程與繳交、獎勵與機會、報名方式與幹部備註。

**你會看到／怎麼驗收：** 幹部在「新增競賽」表單看到新的欄位，都可以不填就發布；填了存檔再打開編輯，內容都在。

## Task 2：已掛上的組別（可見範圍放寬）

**Files:** `supabase/migrations/20260929000002_attached_groups.sql`、`src/server/queries/competitions.ts`。

**先寫的測試（整合）：**
- 第1組掛比賽 A、第2組掛後退出、第3組掛了得獎 → 第5組學生呼叫得到 A 的組名只有 `第1組、第3組`；
- 退出後重掛只出現一次；
- 草稿比賽不出現；
- 上學期的比賽不出現；
- 不在名單上的登入者拿到空集合；
- 第5組學生直接查 `competition_entries`／`entry_members`／`stage_submissions` 仍拿不到別組資料（沿用既有斷言，另加一次）；
- 突變檢查：把函式的退出條件拿掉 → 紅。

**實作：**
- `competition_attached_groups()`：
  - SECURITY DEFINER、`search_path=public`、只 grant 給 authenticated；
  - 呼叫者必須是本學期名單上的人；
  - 回傳 `(competition_id uuid, group_name text)`。
- 管理員（服務身分）走同樣欄位的查詢。
- `loadLobby` 回傳 `attachedGroups: Record<competitionId, string[]>`。

**你會看到／怎麼驗收：** 用第1組身份掛一場比賽，切成第2組身份打開大廳，卡片下方看到「第1組已掛上」。

## Task 3：大廳卡片改版

**Files:** `src/components/competition-card.tsx`、`src/domain/competition.ts`（賽制摘要、獎金格式）、大廳頁。

**先寫的測試：**
- 單元：
  - `formatPrize(100000)` → `NT$100,000`；
  - `stageSummary`：只有報名 → `報名`；報名＋決賽 → `報名 → 決賽`。
- 元件：
  - 有推薦 → 顯示 `幹部推薦` 標記；
  - 標籤依清單順序；
  - 報名截止為 danger 色並顯示 `剩 N 天`（沿用第 14 節已做好的紅字）；
  - 沒填最高獎金、隊伍 → 該格不出現；
  - 沒有掛上的組 → 不顯示那一行；
  - 整張卡片可點，連到 `/competitions/{id}`；
  - 「掛到我們組」與「編輯」按鈕仍可獨立點擊。

**實作：** 依樣張排版：
- 名稱＋主辦；
- 右上角推薦標記；
- 標籤列；
- 四格資訊（報名截止、最高獎金、隊伍、賽制）；
- 底部已掛上的組別。

**你會看到／怎麼驗收：** 大廳卡片跟審核通過的樣張 A 一致；手機上每張卡片不會超出畫面。

## Task 4：詳細頁 `/competitions/[id]`

**Files:** `src/app/(app)/competitions/[id]/page.tsx`（＋`loading.tsx`、`not-found` 沿用）、`src/server/queries/competitions.ts`（`loadCompetitionDetail(id)`）。

**先寫的測試：**
- 整合：
  - 學生讀已發布 → 有資料；
  - 學生讀草稿 → null；
  - 其他幹部讀草稿 → 有資料；
  - 上學期的比賽 → null；
  - 亂填 id → null。
- 元件：
  - 每一區沒有內容時整區不顯示；
  - 賽程列出說明會與三個階段，日期格式 `10/31（五）17:00`，報名截止紅字；
  - 幹部備註保留換行；
  - 學生看到「掛到我們組」，幹部看到「編輯」。
- E2E：
  - 學生從大廳點卡片進詳細頁，看到一句話介紹與賽程；
  - 學生打草稿網址看到找不到頁面。

**實作：** 依樣張 B：
- 標題區（名稱、主辦、標籤、推薦）；
- 一句話介紹；
- 參賽資格；
- 賽程與繳交；
- 獎勵與機會；
- 組隊需求（隊伍人數、建議技能）；
- 報名方式（報名費、需準備文件、官方連結按鈕）；
- 幹部備註；
- 已掛上的組別。

**你會看到／怎麼驗收：** 點大廳任一張卡片進到詳細頁，看到樣張 B 的排版；舊比賽只顯示有填的區塊。

## Task 5：整合檢查

- 全套測試連跑三次。
- 截圖兩輪：大廳、詳細頁（完整資料與只有必填的舊資料）、新增表單，桌機＋手機。
- 更新 `HANDOFF.md`。
- 更新 `scripts/demo-seed.ts`，讓示範比賽有完整新欄位，也保留一場只有必填的。
- 部署前在正式 Supabase 執行 `npx supabase db push`（新 migration 兩個）。

**你會看到／怎麼驗收：** 合併上線後，正式站的競賽大廳和詳細頁都是新樣子；原本的測試比賽沒有壞。

---

## 我先訂的細節（請確認）

1. 一句話介紹最多 80 字；其他文字欄位最多 500 字。
2. 「已掛上」不含已退出的組；已得獎、未入選的組仍列出。
3. 幹部推薦與幹部備註：所有幹部都能改（跟編輯競賽同一批人），不限專案幹部。
4. 卡片的「賽制」自動用有日期的階段串起來，不另外填。
5. 點整張卡片進詳細頁；官方連結改放在詳細頁（卡片上不再放）。
