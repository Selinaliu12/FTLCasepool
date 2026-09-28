# FTL 競賽池 檢視後調整 實作計畫（名單欄位、多重身份、組別備註、期別自由修改）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. TDD 垂直切片（一個失敗測試 → 紅 → 最少實作 → 綠）；權限測試要做「故意放寬 → 紅」的突變檢查；畫面 Task 收尾截 1280×800 與 375×812 兩輪存 `.screenshots/round{1,2}-adj-*`。

**Goal:** 依規格第 14 節調整：名單新欄位（學號、系級、專案名稱選填）、同一信箱多重身份（含多組專案生）與頁首切換、看板卡片列組員與系級與組別備註、學生組頁顯示組員並可編輯備註、管理員可自由改刪期別、競賽大廳報名截止日紅字。

**Architecture:** `members` 改成「一個信箱在同一學期可以有多列」。RLS 取所有身份的**聯集**（`my_groups()` 集合、`is_staff()`＝任一身份是幹部），因為使用者本來就能隨時切換，聯集不會多給權限。應用程式層以「目前身份」決定畫面與動作；目前身份存在 cookie，每次請求都對照名單驗證，不合法就退回第一個身份。

**Spec:** `docs/superpowers/specs/2026-09-26-ftl-casepool-design.md` 第 14 節（優先於第 12、13 節與前文）。

## Global Constraints

- 批次 1、2 的 Global Constraints 全部適用。
- 名單 CSV 標題固定：`email,姓名,角色,學號,系級,組別,專案名稱`（專案名稱選填）。舊格式（沒有學號、系級）要回清楚錯誤：`缺少欄位：學號、系級`。
- 同一信箱多列時：姓名、學號、系級必須一致，否則 `第 N 列：同一個信箱的姓名／學號／系級要一致（和第 M 列不同）`；完全重複的身份（同信箱、同角色、同組）→ `第 N 列：和第 M 列是同一個身份`；幹部列不能填組別；專案生一定要填組別。
- 同一組的專案名稱：有填的列必須一致；可以全部空白。
- 身份顯示文字：`第N組專案生`、`專案幹部`、`其他幹部`、`管理員`（管理員沒有名單列時）。
- 組別備註：選填，最多 200 字，空白存成 null；只有該組的專案生（以任一身份屬於該組）可以改；幹部、管理員、該組看得到。
- 競賽卡片的報名截止日文字用 `--danger` 色。
- 權限一律以「使用者所有身份的聯集」判斷資料庫讀取；寫入動作以「目前身份」判斷（例如交進度的組別＝目前身份的組）。

## Review Focus

1. **學生從第1組身份切到第3組**，交件頁、上傳、燈號、備註都要跟著換組；切換後打開舊組網址要被擋（目前身份不是那組）。
2. **cookie 被竄改成別人的身份或不存在的身份** → 退回第一個合法身份，不報錯、不越權。
3. **換組（moveMember）在多列名單下**：只移動那一列專案生身份，不影響同一人的其他身份。
4. **刪除有人交件的期別**：進度與 R2 檔案一起刪，鎖定觸發器不能擋住這個管理員動作，但一般學生路徑仍被鎖定保護。
5. **舊資料相容**：批次 1、2 已有的成員資料（學號、系級為空）不能讓頁面壞掉，顯示「—」。

---

## Task 1：競賽大廳報名截止日紅字（暖身）

卡片上「報名截止：…」那一行改成 `text-[var(--danger)]`（沿用設計代幣），已截止區也一樣。元件測試斷言該元素有 danger 樣式。截圖兩輪。

## Task 2：名單新欄位與多列身份

**Files:** `supabase/migrations/…021_roster_v2.sql`、`src/domain/roster-csv.ts`、`import_roster` 函式、`src/server/actions/admin.ts`（moveMember、setPmGroups 相容）、管理員頁名單相關顯示。

- `members` 加 `student_id text`、`dept_year text`（皆可為 null，舊資料相容）；拿掉 `unique(semester_id, email)`，改成 `unique(semester_id, email, role, coalesce(group_id, '00000000-0000-0000-0000-000000000000'))`（用唯一索引實作）。
- `groups.project_name` 改為可為 null。
- `parseRosterCsv` 依 Global Constraints 的新欄位與錯誤訊息（一個行為一個紅綠循環；Excel BOM、大小寫等舊測試保留並改用新欄位）。
- `import_roster` 接受新欄位，原子寫入。
- `moveMember(memberId, toGroupId)` 只動那一列；同一人在目標組已有專案生身份 → `這位同學已經在第N組了`。
- `setPmGroups` 以「專案幹部那一列的 id」運作不變。
- 管理員頁：換組選單顯示「姓名（學號）· 第N組」；有多身份的人每個專案生身份各一個選項。
- 整合測試：多列匯入、同人兩組、資料不一致被拒、舊成員無學號不壞。

## Task 3：多重身份的存取模型與頁首切換

**Files:** `supabase/migrations/…022_multi_identity_rls.sql`、`src/domain/access.ts`、`src/server/session.ts`、`src/server/actions/identity.ts`、頁首元件、所有依賴 `access.member` 的查詢與動作。

- 資料庫：新增 `my_groups()`（回傳目前使用者所有專案生身份的組 id 集合，SECURITY DEFINER、`search_path=public`、只給 authenticated）、`is_staff()`／`is_pm()` 改成「任一身份」；所有用到 `= my_group()` 的 policy 與 view 改成 `in (select my_groups())`；`me()` 保留給需要單一列的地方或改寫（實作時列出每個使用點）。專案幹部負責組別照舊用 pm_assignments。
- 應用程式：`Access` 的 `ok` 變成帶 `identities: Identity[]` 與 `active: Identity`（`Identity = { memberId, role, groupId | null, label }`）；管理員沒有名單列時 `identities` 只有 `{ role: 'admin' }`；管理員有名單列時加一個「管理員」身份。
- 目前身份：cookie `ftl_identity`（memberId 或 `admin`），`getAccess` 每次對照名單驗證，不合法就用第一個；`switchIdentity(id)` 伺服器動作設定 cookie（httpOnly、sameSite=lax）並導到該身份的首頁（專案生→/my-group、幹部→/dashboard、管理員→/admin）。
- 所有伺服器動作與查詢把 `access.member` 換成 `access.active`（交進度、中間週、上傳、比賽報名、階段上傳、審核、下載、看板、組頁、組別內容頁、待審清單）。審核與看板「你負責」用目前身份若是專案幹部的那一列。
- 頁首：名字旁「身份：{label} ▾」，只有多於一個身份時顯示；shadcn DropdownMenu。
- 說明頁「我已了解」照舊以 email＋學期記錄一次即可。
- 測試：Review Focus 1、2、3；RLS 聯集（學生＋其他幹部的人讀得到自己組內容）＋突變檢查；多組學生切換後交件落在正確的組；審自己組允許（規格第 14 節第 4 點）。全套批次 1、2 測試必須維持綠（必要時更新 helper 以新 Access 形狀，不放寬斷言）。

## Task 4：看板卡片組員與備註、學生組頁組員與備註

**Files:** migration `…023_group_note.sql`（`groups.note text`、`note_updated_by text`、`note_updated_at timestamptz`；寫入走 SECURITY DEFINER 函式只給 service_role）、`src/server/actions/group-note.ts`、看板查詢與 `GroupCard`、`/my-group`、`/groups/[id]`。

- 看板卡片：組名、專案名稱（有填才顯示）、備註（沒填顯示「尚未訂題」）、組員清單「姓名 · 系級」（系級空白顯示「—」）。
- `/my-group`：本組組員清單（姓名、系級）、備註編輯（Textarea、最多 200 字、儲存中狀態、錯誤訊息、顯示「最後由 {姓名} 於 {時間} 更新」）。
- `/groups/[id]`：組員（姓名、學號、系級）與備註。
- `updateGroupNote(note)`：以目前身份的組；非專案生身份 → `只有專案生可以修改組別備註`；超過 200 字 → `備註最多 200 字`。
- 別組學生讀不到其他組的組員與備註（RLS 測試＋突變檢查）；其他幹部讀得到（規格第 14 節第 6 點）。

## Task 5：管理員自由修改與刪除期別

**Files:** migration `…024_periods_free_edit.sql`（改寫 `save_periods`）、`periods-form.tsx`、`src/server/actions/admin.ts`。

- 任何一期都能改截止日（含已有人交件的期別）；準時與否自然依新日期重算。
- 刪除有人交件的期別：前端先呼叫 `previewPeriodDeletion(periodIds)` 取得每期的交件組數，Dialog 顯示「第 N 期有 M 組交了進度，刪除會一併刪掉這些進度與檔案」，需輸入「刪除」才能送出；伺服器再以 `confirmDeleteWithReports: true` 呼叫，否則回 `這期已經有組別交了進度，要刪除請先確認`。
- 刪除時：在同一個交易裡刪除該期的 progress_reports（用交易內 `set_config('app.allow_admin_period_delete','on', true)` 讓鎖定觸發器放行，觸發器改成檢查這個設定；一般路徑仍受鎖定保護）；交易成功後刪除對應的 R2 物件。
- 期別依日期重新編號（沿用現有的負數暫存編號法）。
- 移除批次 1 的「已有人交件的期別與之前期別鎖定」規則與相關 UI 標籤；相關舊測試改寫成新行為（這是產品決定的改變，不是放寬測試）。
- 測試：改已交期別的日期後準時率改變；未確認刪除被拒；確認刪除後進度與檔案都不見；一般學生撤回已鎖定的進度仍被拒（Review Focus 4）。

## Task 6：整合檢查

全套三次、截圖兩輪（看板卡片、學生組頁、身份切換選單、期別刪除確認、競賽紅字）、更新 HANDOFF 與示範資料腳本。
