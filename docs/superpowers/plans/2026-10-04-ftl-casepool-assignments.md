# 作業、專案幹部看別組、校外成員登入 實作計畫（規格 §17）

分支：`feat/assignments`（從 `main` 開）。每個 Task 只跑相關測試；全部做完統一審查一次，合併前才跑全套。
推送、合併、對正式 Supabase `db push` 都先問產品負責人。

「放寬就會失敗」測試：每條權限規則都要有一個「不該看到／不該做到」的測試，規則一放寬，測試就紅。

---

## Task 1　校外成員登入（§17-16～19）

**資料庫** `supabase/migrations/20261004000001_open_login.sql`
- `members.email` 檢查改成：小寫＋基本信箱格式 `^[^@\s]+@[^@\s]+\.[^@\s]+$`。
- 名單相關函式（`import_roster`、`admin_add_member`、`admin_edit_person`、`admin_change_email` 等）裡寫死的 `@g.nccu.edu.tw` 改成同一個格式；migration 結尾檢查：`public` 裡還有函式含 `nccu` 就 `raise exception`（漏改會直接失敗）。
- `my_members()` **不動**：仍只信任 Google（本機 test-login 旗標例外照舊）。

**程式**
- `src/domain/access.ts`：新增 `EMAIL_RE`；`resolveAccess` 改用格式檢查；`isTrustedProvider` 不變。
- `src/domain/roster-csv.ts`、`src/server/actions/admin.ts`：網域檢查改格式檢查，錯誤文字「email 格式不正確」。
- `src/app/login/login-button.tsx`：拿掉 `hd: "g.nccu.edu.tw"`，按鈕「用 Google 帳號登入」。
- 文案：登入錯誤、隱私權頁、管理員頁 placeholder、`docs/runbook.md`（名單格式、Google 帳號說明）。

**測試**
- 單元：Gmail／校外信箱名單驗證通過；格式錯的被擋；`resolveAccess` 校外信箱不在名單 → `not_in_roster`；`isTrustedProvider("email", false)` → false（放寬就失敗）。
- 整合：資料庫接受 `x@gmail.com`、拒絕 `bad-email`；`my_members()` 對 provider=email（旗標關）回傳空的（放寬就失敗）；名單上的 Gmail 用 google provider 能讀到自己組。
- 既有測試裡寫死 `@g.nccu.edu.tw` 的錯誤訊息斷言跟著改。

## Task 2　專案幹部只看負責組的內容（§17-12～15）

**資料庫** `20261004000002_pm_content_scope.sql`
- 新函式 `my_pm_groups()`：呼叫者以專案幹部身份負責的組（`pm_assignments` × `my_members()`）。
- `can_read_content(l)` 改成：`line_group(l) in my_groups() or line_group(l) in my_pm_groups()`。
- 逐一檢查用到 `is_pm()` 判斷「看內容」的 policy（`stage_submissions`、`entry_members` 等），改用同一規則；看狀態的（`can_read_status`）不動。

**程式**
- `src/server/queries/group-detail.ts`＋`groups/[groupId]/page.tsx`：非負責組回傳「只看狀態」版本（燈號、來源、繳交時間、準時率、階段狀態、作業清單），不帶三句話、PDF、紅燈說明、階段檔案、評語。
- `dashboard/page.tsx`：專案幹部每張卡都能點進組別頁（負責組＝完整、其他＝只看狀態）。
- `download.ts`：照舊走使用者連線，靠 RLS 擋。
- 第一次登入說明頁第 1 點、隱私權頁：「負責的專案幹部」。

**測試（整合，放寬就失敗）**
- 非負責專案幹部：讀不到別組 `progress_reports`、`checkins` 的內容、`stage_submissions`；下載別組 PDF 回「找不到」；組別頁拿到只看狀態版本、沒有三句話。
- 負責專案幹部：照舊看得到（防止收太緊）。
- 專案幹部同時是某組專案生：看得到自己那組。

## Task 3　作業資料表與權限（§17-1～11）

**資料庫** `20261004000003_assignments.sql`
- `assignments`：id、semester_id、title（非空）、description、deadline、created_by（members.id）、created_at、updated_at。
- `assignment_groups`：(assignment_id, group_id) 主鍵；組必須同學期。
- `assignment_submissions`：id、assignment_id、line_id（專案線）、note、submitted_by、pdf_key（unique）、pdf_size、pdf_uploaded_at、pdf_uploaded_by、時間戳；unique(assignment_id, line_id)；`reject_if_locked` trigger 套用（2 小時鎖定）。
- RLS：
  - `assignments`／`assignment_groups`：所有幹部（`is_staff()`）＋被派到的組的組員。
  - `assignment_submissions`（內容）：該組組員、出題者、該組負責專案幹部。
  - 狀態（交了沒、繳交時間）：`assignment_status()` security definer 函式，只回 `can_read_status` 看得到的組，不回 note／pdf_key。
- RPC（只給 service_role，同既有寫入模式）：
  - `create_assignment`、`update_assignment`（含改派給的組）、`delete_assignment`：檢查呼叫者是出題者且未離開；移除已交的組或刪除時需傳入 `p_confirm_count` 等於已交組數，否則 `raise 'needs_confirm:N'`。
  - `submit_assignment`、`replace_assignment_pdf`、`withdraw_assignment`、`edit_assignment_note`：走上傳票（`upload_tickets`），同雙週進度。

**測試（整合，放寬就失敗）**
- 別組學生讀不到作業與狀態；未被派到的組不能交。
- 非出題的專案幹部、管理員、其他幹部：不能改、不能刪。
- 出題者不是負責幹部時看得到該作業內容；別份作業的內容看不到。
- 其他幹部、非負責非出題專案幹部：看得到狀態、讀不到 note／PDF。
- 滿 2 小時後改說明／換檔／撤回都被擋。
- 刪除已有人交的作業，沒帶正確確認數就失敗。

## Task 4　作業的伺服器動作與判燈

- `src/domain/assignment.ts`：驗證（標題必填、截止時間、至少一組、說明長度）、`assignmentLabel(title)` → `作業「標題」`。
- `src/server/actions/assignments.ts`：出題者的建立／修改／刪除（目前身份必須是專案幹部）；組員的繳交／換 PDF／改說明／撤回（目前身份必須是該組專案生）。PDF 走 `requestPdfUpload`，R2 路徑 `學期/組/assignments/<id>/...`。
- `download.ts`：新增 `getAssignmentPdfDownloadUrl`（使用者連線＋RLS）。
- 判燈：`queries/dashboard.ts`、`group-detail.ts`、`my-group.ts` 把被派到的作業加進專案線的 `Deliverable[]`（系統判定燈＋準時率）。

**測試**：domain 單元測試；動作整合測試（交、換檔重算繳交時間、撤回、鎖定、逾期補交）；看板燈號：作業逾期 2 天 → 專案線黃燈、來源「系統：作業「X」逾期 2 天」，滿 72 小時紅；準時率含作業。

## Task 5　畫面

- 新頁 `/assignments`（專案幹部身份才看得到，頁首加連結）：「我出的作業」可新增／修改／刪除（刪除與取消派組時顯示已交組數並打字確認）；「所有作業」列表（出題者、派給哪些組、各組交了沒）。
- `/my-group`：「作業」區塊列出被派到的作業（截止、狀態）；`/my-group/assignments/[id]`：繳交頁（PDF＋選填說明、2 小時內可改、「⚠️ 替換檔案後，繳交時間以新檔案為準。」）。
- 組別頁：作業清單與各份狀態；有內容權限才顯示 PDF 與說明。
- 375 寬不橫向捲動；E2E：專案幹部出作業 → 學生交 → 看板燈號。

## Task 6　文件

- `HANDOFF.md`：更新狀態（PR #8 已合併）、這一批內容、要 `db push` 的 migration 清單、測試證據。
- `docs/runbook.md`：校外成員名單、專案幹部出作業說明。

## Task 7　統一審查與全套測試

- 一次 code review（權限、RLS、鎖定、上傳票）；修正。
- 全套：`npm run test:unit`、`npm run test:integration`、`npx playwright test`、`tsc`、`eslint`、`next build`。
- 結果寫進 HANDOFF，然後問產品負責人：推送／開 PR／正式 `db push`。
