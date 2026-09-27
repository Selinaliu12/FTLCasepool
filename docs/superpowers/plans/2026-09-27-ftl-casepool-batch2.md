# FTL 競賽池 批次 2 實作計畫（競賽大廳、比賽線、階段審核、每期建議內容）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **TDD 是最高原則**（`~/.claude/policies/testing-policy.md`）：每個行為一個垂直切片「寫一個失敗測試 → 親眼看到紅 → 最少實作 → 綠 → 重構」。紅綠循環只跑當前測試檔；每個 Task 收尾跑一次全套。權限相關測試要做「故意放寬 → 看到紅」的突變檢查。
>
> **前端規範**（`~/.claude/policies/frontend-codex.md`）：有畫面的 Task 收尾時用 Playwright 截 1280×800 與 375×812 存 `.screenshots/b2-*`，兩輪自評；基礎元件一律 shadcn/ui。

**Goal:** 在本機完成批次 2：幹部整理競賽卡片（草稿→發布），組別把比賽掛到自己專案、勾參賽成員、確認報名產生比賽線；比賽線三個階段上傳 PDF、2 小時鎖定、專案幹部審核（通過／退回＋評語）；燈號與看板納入比賽線；「待你審核」清單；每期建議繳交內容。

**Architecture:** 沿用批次 1：規則寫成 `src/domain/` 純函式（單元測試），權限在 Postgres RLS（本機 Supabase 整合測試），寫入一律走服務身分或 SECURITY DEFINER 函式（只給 service_role），檔案沿用上傳票＋直傳 S3/R2。比賽線階段的截止日不複製，直接讀競賽卡片，所以幹部改日期會自動生效。

**Tech Stack:** 同批次 1（Next.js 15、Supabase、S3/R2、Vitest、Playwright、shadcn/ui）。

**Spec:** `docs/superpowers/specs/2026-09-26-ftl-casepool-design.md`（**第 13 節優先於前文，第 12 節次之**）＋ `PRODUCT.md`。

## Global Constraints

- 批次 1 的 Global Constraints 全部適用（見 `2026-09-26-ftl-casepool-batch1.md`）。
- 預設權限已收緊：每張新表要自己 `enable row level security`＋需要的 `grant select ... to authenticated`＋policy；每個新函式要明寫 `grant execute`，SECURITY DEFINER 一律 `set search_path = public`，寫入用的函式只給 `service_role`。
- 權限表（規格第 3 節）：
  - 新增、編輯、發布競賽：管理員、專案幹部、其他幹部。
  - 看競賽大廳（已發布）：所有人；草稿只有幹部與管理員。
  - 看所有組的燈號、階段、參賽清單：所有幹部與管理員；專案生只看自己組。
  - 看比賽階段內容（PDF、評語）：管理員、專案幹部、自己組；其他幹部看不到。
  - 審核比賽階段、寫評語：**只有負責該組的專案幹部**。
  - 掛比賽、確認報名、上傳階段檔案、填比賽結果、取消報名：該組專案生。
- 競賽卡片必填：名稱、官方連結（http/https）、報名截止日；其餘選填。
- 階段：報名（截止日＝報名截止日，上傳「報名成功證明 PDF」）、繳件（繳件截止日，「送出的作品 PDF」）、決賽（決賽日期，「決賽簡報 PDF」）。截止日未填的階段不判逾期。
- 審核：鎖定（上傳滿 2 小時）後才送到專案幹部；退回必須填原因；退回後重交保留每一版；**完成日＝最後通過那一版的送出時間**；準時與否只看該階段第一次送出的時間。
- 狀態：準備中 → 已報名（報名階段通過）→ 已繳件（繳件階段通過）→ 晉級／得獎／未入選（組員手動填）；另有「已退出」。
- 比賽線沒有組員回報燈，只有系統判定燈（被退回未重交 → 黃；逾期規則同批次 1）。已退出、未入選、得獎的線之後的階段不判燈。
- 文字：競賽大廳標題「競賽大廳」、已截止區「已截止」、剩餘天數同批次 1 格式（`剩 N 天`／`今天截止`）。

## Review Focus

1. **幹部把報名截止日改早**，某組原本準時的報名變成逾期 → 準時率以「當時的截止日」還是「現在的截止日」？依規格「日期直接取自競賽卡片」，以現在的截止日計算；畫面要顯示最新截止日。測試在 Task 4。
2. **同一組重複掛同一場比賽** → 只能一筆（取消後可重新掛，產生新的一條線）。測試在 Task 3。
3. **退回後、重交前又被退回的舊版被再審** → 只有最新一版能審；舊版唯讀。測試在 Task 6。
4. **專案幹部被換掉負責組別** → 待審清單與審核權限立即跟著變。測試在 Task 6。
5. **草稿被學生用網址直接打開** → 404，資料庫層也讀不到。測試在 Task 2。

---

## 檔案地圖（新增為主）

```
supabase/migrations/20260927000010_period_suggestion.sql
supabase/migrations/20260927000011_competitions.sql      競賽卡片
supabase/migrations/20260927000012_entries.sql           掛比賽、參賽成員、比賽線
supabase/migrations/20260927000013_stage_submissions.sql 階段繳交、鎖定、審核
src/domain/competition.ts        卡片檢查、排序、剩幾天、已截止
src/domain/competition-line.ts   階段清單、截止日、系統燈、準時率、狀態、完成日
src/server/actions/competitions.ts   新增／編輯／發布（幹部）
src/server/actions/entries.ts        掛比賽、成員、確認報名、取消、填結果（學生）
src/server/actions/stages.ts         階段上傳／修改／撤回（學生）、審核（專案幹部）
src/server/queries/competitions.ts   競賽大廳
src/server/queries/review-queue.ts   待你審核
src/app/(app)/competitions/…         競賽大廳、新增／編輯
src/app/(app)/my-group/competitions/[entryId]/…  報名與階段
```

---

## Task 1：每期建議繳交內容

**Files:** migration `…010_period_suggestion.sql`（`periods.suggestion text null`，`save_periods` 接受並保存每列的 suggestion；已鎖期別的 suggestion **仍可修改**，因為它不影響繳交判定）、`periods-form.tsx`、`/my-group` 與交件頁。

**行為（各一個紅→綠）：**
1. `savePeriods` 保存每列的建議內容（空白字串存成 null）；已有人交件的期別仍可改建議內容，但日期仍不可改。
2. 學生組頁每期顯示「本期建議繳交：…」；交件頁表單上方顯示同一段；沒填就不顯示任何建議區塊（取代批次 1 的固定建議文字）。
3. 管理員期別表每列多一個「建議內容（選填）」多行文字欄。

**你會看到什麼：** 管理員在期別表每一期可以寫一段建議，學生打開那一期就看到。

---

## Task 2：競賽卡片（幹部新增／編輯／發布）與競賽大廳

**Files:** migration `…011_competitions.sql`、`src/domain/competition.ts`、`src/server/actions/competitions.ts`、`src/server/queries/competitions.ts`、`src/app/(app)/competitions/page.tsx`、`new/page.tsx`、`[id]/edit/page.tsx`、共用表單元件、頁首加「競賽大廳」連結（所有身分）。

**資料表** `competitions(id, semester_id, name, organizer, theme, eligibility, team_size, prize, url, signup_deadline timestamptz not null, submission_deadline timestamptz, final_date timestamptz, status text check in ('draft','published'), created_by, created_at, updated_at)`；RLS：已發布且屬本學期 → 名單內所有人可讀；草稿 → 只有幹部可讀；管理員走服務身分。

**Interfaces:**
- `validateCompetition(input) → { ok: true } | { ok: false; errors: Record<field, string> }`：名稱空白 `請填比賽名稱`；網址不是 http/https `請填正確的官方連結`；報名截止日缺 `請填報名截止日`；繳件日早於報名截止 `繳件截止日不能早於報名截止日`；決賽日早於繳件日 `決賽日期不能早於繳件截止日`。日期輸入沿用 `parseTaipeiDeadline`（日期＋時間，時間預設 23:59）。
- `sortLobby(cards, now) → { open: Card[]; closed: Card[] }`：報名截止日由近到遠；已過報名截止的移到 closed（由近到遠的相反：最近截止的在前）。
- `createCompetition / updateCompetition / publishCompetition`：只有幹部與管理員，否則 `只有幹部可以編輯競賽`。

**行為：**
1. 驗證規則各一個測試（純函式）。
2. 排序與已截止分區（純函式，含台北時區邊界）。
3. 幹部存草稿；學生讀不到草稿（RLS 真實邊界測試＋學生打 `/competitions/[id]/edit` 得 404）。
4. 發布後所有名單內的人在大廳看得到；卡片顯示 10 個欄位中有填的、剩餘天數。
5. 其他幹部、專案幹部、管理員都能新增與編輯；學生呼叫動作被拒。
6. 大廳 E2E：幹部新增→存草稿→發布→學生看到卡片。

**你會看到什麼：** 頁首多「競賽大廳」。幹部有「新增競賽」按鈕，可存草稿再發布；大家看到依報名截止日排好的卡片與剩幾天，過了截止的在下方「已截止」。

---

## Task 3：掛比賽、參賽成員、確認報名、取消報名

**Files:** migration `…012_entries.sql`、`src/server/actions/entries.ts`、大廳卡片「掛到我們組」按鈕、`/my-group/competitions/[entryId]/page.tsx`。

**資料表**
- `competition_entries(id, group_id, competition_id, created_by, created_at, confirmed_at, withdrawn_at, result text check in ('advanced','awarded','not_selected') null)`；唯一條件：同一組同一比賽**未退出**的只能一筆（部分唯一索引 `where withdrawn_at is null`）。
- `entry_members(entry_id, member_id)`：成員必須是同一組的專案生。
- `lines` 加 `entry_id uuid null references competition_entries`；確認報名時建立 `kind='competition'` 的線。
- RLS：參賽清單（entries、entry_members、比賽線）→ 所有幹部與自己組可讀。

**行為：**
1. 學生把已發布、未過報名截止的比賽掛到自己組；重複掛同一場被拒 `這場比賽已經掛在你們組了`；過了報名截止被拒 `已經過了報名截止日`。
2. 勾參賽成員：只能勾自己組的專案生；至少一人 `請至少勾選一位參賽成員`。
3. 確認報名：產生比賽線（原子操作，SQL 函式），確認後不能再改參賽成員以外的設定（通知專案幹部的 email 在批次 3）。
4. 取消報名：比賽線標成已退出（`withdrawn_at`），停止判燈；檔案與審核紀錄保留；取消後可以重新掛同一場。
5. 別組學生、幹部不能對這組做以上動作（統一回 `找不到這筆報名`）。

**你會看到什麼：** 學生在大廳按「掛到我們組」，勾選參賽成員後按「確認報名」，組頁多出這場比賽。

---

## Task 4：比賽線的階段、燈號、看板

**Files:** `src/domain/competition-line.ts`、`my-group` 與 `dashboard` 查詢、`GroupCard`、組頁比賽區塊。

**Interfaces（純函式）：**
- `competitionStages(comp, entry, submissions, now) → Stage[]`：`{ key: 'signup'|'submission'|'final'; label: '報名'|'繳件'|'決賽'; deadline: Date | null; required: boolean; firstSubmittedAt; latest: { version; status: 'pending'|'approved'|'returned'; locked } | null; completedAt }`。`required=false` 的情況：已退出、`result` 為 `not_selected`／`awarded` 之後的階段、截止日為 null。
- `competitionLineLight(stages, now, redAfterHours) → SystemLight`：沿用 `systemLight`；deliverable label 用 `{比賽名} 報名` 等；被退回且沒有更新版本 → `returned: true`。
- `competitionStatus(stages, entry) → '準備中'|'已報名'|'已繳件'|'晉級'|'得獎'|'未入選'|'已退出'`。
- `competitionOnTime(stages, now)`：只看 `firstSubmittedAt` 與目前截止日。

**行為：**
1. 各純函式的測試（含：截止日為 null 不判逾期、未入選後決賽不要求、退回未重交黃燈、截止日被改早後以新截止日計算＝Review Focus 1）。
2. 組頁列出每條比賽線：狀態、三個階段的截止日與繳交狀態、系統燈。
3. 看板組卡列出專案線＋每條比賽線的燈號與準時率；組的排序用所有線中最嚴重的燈。
4. 幹部修改卡片日期後，已報名組的階段截止日立即更新（整合測試）。

**你會看到什麼：** 組頁與看板每場比賽一行，看得到在哪個階段、下一個截止日、燈號。

---

## Task 5：比賽階段上傳（2 小時可改、之後鎖定）

**Files:** migration `…013_stage_submissions.sql`（`stage_submissions(id, line_id, stage, version, pdf_key unique, pdf_size, pdf_uploaded_at, pdf_uploaded_by, submitted_by, created_at, review_status default 'pending', reviewed_by, reviewed_at, comment)`、沿用 `reject_if_locked` 類型的鎖定觸發器、上傳票）、`src/server/actions/stages.ts`、階段上傳畫面。

**行為：**
1. 只有該組專案生、在比賽線未結束時可以上傳；每個階段同時只能有一份「待審或已通過」的版本；被退回後才能交下一版（版本號＋1）。
2. 上傳安全鏈同批次 1：字首、上傳票（上傳者本人、未用）、檢查 PDF、原子寫入。
3. 2 小時內可換 PDF 或撤回（撤回不留紀錄、不算版本）；之後鎖定，資料庫觸發器也擋。
4. 權限：其他幹部讀不到階段內容；專案幹部與自己組讀得到（RLS 測試＋突變檢查）。

**你會看到什麼：** 組頁每個階段有「上傳」按鈕，交完 2 小時內可換或撤回。

---

## Task 6：專案幹部審核與「待你審核」

**Files:** `stages.ts`（`reviewStage(submissionId, decision, comment)`）、`src/server/queries/review-queue.ts`、看板上方「待你審核」、`/groups/[id]` 的審核區。

**行為：**
1. 只有負責該組的專案幹部可以審（統一回 `找不到這筆繳交`）；只能審**已鎖定**且是**最新一版**的繳交（Review Focus 3）。
2. 通過：狀態前進（報名通過 → 已報名；繳件通過 → 已繳件）；完成日＝該版送出時間。
3. 退回：必須填原因 `退回請寫原因`；比賽線系統燈轉黃直到重交。
4. 「待你審核」清單：負責組別已鎖定、待審的繳交，顯示組名、比賽、階段、版本、已等幾天；換負責組別後立即更新（Review Focus 4）。
5. 組員看得到每一版的審核結果與評語。
6. 沒有指派專案幹部的組別：管理員頁顯示提醒「第 N 組還沒有負責的專案幹部，比賽階段沒人能審核」。

**你會看到什麼：** 專案幹部打開看板，上方有「待你審核」，點進去看 PDF、按通過或退回並寫評語。

---

## Task 7：比賽結果

**Files:** `entries.ts`（`setResult`）、組頁結果選單。

**行為：**
1. 組員可在已報名後填結果：晉級／得獎／未入選；可更正。
2. 填未入選或得獎 → 比賽線結束，之後沒交的階段不要求、不判燈；填晉級 → 繼續要求決賽。
3. 看板與組頁顯示結果。

---

## Task 8：整合檢查

全套測試三次、截圖兩輪（大廳、新增表單、報名頁、組頁比賽區、看板含待審、審核區），更新 HANDOFF。

## 不在這一批

AI 貼網址整理（批次 4）、email 通知（批次 3）、專案里程碑 M1–M3（批次 3）、期末匯出（批次 5）。
