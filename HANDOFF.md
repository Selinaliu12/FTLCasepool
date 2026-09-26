# HANDOFF — FTL 競賽池

最後更新：2026-09-27（台北）

## 專案一句話

FTL 社團（約 6 組、40 人）的學期專案追蹤工具：組別交雙週進度、點燈號，系統依截止日自動判燈，幹部一頁看出哪組需要幫忙。

## 重要文件

| 文件 | 用途 |
| --- | --- |
| `docs/superpowers/specs/2026-09-26-ftl-casepool-design.md` | 規格 v5.0。**第 12 節是 2026-09-26 補問的 11 項決定，優先於前文** |
| `docs/superpowers/plans/2026-09-26-ftl-casepool-batch1.md` | 批次 1（10/02 上線）實作計畫，Task 0–13 |
| `PRODUCT.md` | 產品對象與視覺方向（沿用社團網站配色、字體、圓角） |

## 本輪狀態

- 第一版（Task 1–12）已經由 PR [Selinaliu12/FTLCasepool#1](https://github.com/Selinaliu12/FTLCasepool/pull/1) 合併進 `main`（`0610ceb`）。
- **Task 14 看已交內容**（2026-09-27 產品負責人決定放進第一版）在分支 `feat/content-view` 完成並通過審查，準備開 PR 合併：
  - 專案幹部、管理員：看板組卡有「看內容」，進 `/groups/[id]` 看每期三句話、誰交、何時、準時或逾期、下載 PDF、中間週燈號歷程。
  - 學生：自己組頁可下載自己組的 PDF、看中間週燈號歷程。
  - 其他幹部：沒有入口，直接打網址得到 404。
- **未開始：Task 13 部署**（需要你開帳號，見「下一步」）。

**測試證據（`feat/content-view` @ `bb574b3`，合併前）**
- `npm run test:unit`：29 個檔案、143 個測試通過
- `npm run test:integration`（本機 Supabase）：12 個檔案、129 個測試通過
- `npx playwright test`：19 通過、12 略過（手動截圖用，預設不跑）
- `npx tsc --noEmit`、`npx eslint .`、`npx next build`：皆 exit 0
- 原始紀錄：`.superpowers/sdd/2026-09-26-ftl-casepool-batch1/controller-task14-run.log`（git 忽略的本機檔）
- 環境：macOS、Node v24.21.0、本機 Supabase（Docker）、檔案儲存用本機 Supabase Storage 的 S3 介面代替 R2
- 之後有無相關修改：只有本檔
- **注意**：上傳與下載相關測試目前對本機 S3 跑；上線前必須對真的 R2 測試桶再跑一次。

**截圖**：`.screenshots/` 下各畫面（`content-*` 由 `CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/manual-screenshots.spec.ts` 產生）。

**本機開發注意**
- Docker 的指令不在預設路徑，執行前要 `export PATH="$HOME/.docker/bin:$PATH"`。
- `.env.local` 只放本機測試用金鑰，不要提交、不要用在正式站。
- 執行中請不要在 GitHub Desktop 切換分支或按 Commit。

## 本輪決定（逐題問過產品負責人）

1. 第一版照規格批次 1 全做。
2. 雙週進度各期截止日由管理員逐期填寫。
3. 中間週燈號選填，沒點不影響燈號與準時率。
4. 雙週進度 PDF 必交（1 份），內容自由。
5. 送出後 2 小時內，燈號與三句話可直接改、PDF 可換；只有換 PDF 會更新繳交時間。
6. 管理員 email 放環境變數 `ADMIN_EMAILS`，CSV 角色只填 專案幹部／其他幹部／專案生。
7. PDF 照規格存 Cloudflare R2。
8. 開發電腦安裝 Docker Desktop，本機跑 Supabase 做真實資料庫測試。
9. 批次 3 上線前，里程碑那一期照常交雙週進度。
10. 視覺沿用社團網站 https://hunter20041004.github.io/ftl-web-demo/ 。
11. 上線前已過的期別不列入系統，雙週進度沒有補登。

## 計畫裡先定下、尚待產品負責人確認的小細節

1. **截止時間**：填 23:59 代表 23:59:59 前都算準時。
2. **逾期文字**：未滿 24 小時顯示「逾期 N 小時」，之後顯示「逾期 N 天」（不足一天捨去）。
3. **燈號來源**：組員回報和系統判定一樣嚴重時，兩個來源都顯示。
4. **2 小時鎖定**：從最後一份 PDF 的上傳時間起算，換 PDF 會重新計 2 小時。
5. **截止後換 PDF**：如果原本準時，換之前跳確認框。
6. **名單匯入**：每學期整批匯入一次；之後的異動用「換組」處理。
7. **可以提早交**：學生可以交任何一期。

## 執行中另外做的決定（詳見 `.superpowers/sdd/.../progress.md` 的 Ruling 行）

- 看板同色時依組名數字排序（第2組在第10組前面）。
- 上傳的 PDF 綁定上傳者（「上傳票」），同組同學不能拿別人的檔案代碼交件或刪檔。
- 無權限者修改／撤回別組進度，一律回「找不到這份進度」，不透露是否存在。
- 期別表：已有人交件的期別（和排在它之前的期別）不能改或刪；之後的期別可以改、刪、新增。
- 建新學期要打學期名稱確認，因為建了之後舊學期的人都登不進來。
- 沒按「我已了解」的人，直接呼叫交件功能也會被擋。

## 下一步

1. 合併 `feat/content-view` 後，在 `main` 重跑全套測試。
2. **Task 0／13 部署前你要準備**：Supabase 正式專案、Google OAuth（同意畫面要設成「正式版」）、R2 正式桶＋測試桶＋只限這兩個桶的金鑰與 CORS、Vercel、學期資料（名單 CSV、上線後各期截止日、幹部負責組別）。
3. **部署清單重點**：正式站 Supabase 要關掉 Email 登入方式（不要關全域註冊，否則 Google 新用戶進不來）；Vercel 不可設 `ENABLE_TEST_LOGIN`、`R2_ENDPOINT`；上線前對真 R2 跑契約測試；確認 `local_only_flags` 是空的；先請 1 組試用。

## 之後批次要處理的已知事項

- 第二學期開始前：資料庫權限要加上「只看本學期」的限制。
- 批次 3：清理沒用到的上傳檔與上傳票；中間週燈號的完整歷程。
- 批次 5：刪除學期要先刪進度與 R2 檔（期別現在設成有進度就不能刪）。

## 風險

- 10/02 只剩 6 天。程式面已完成，剩下最可能延誤的是帳號開通（R2 綁卡、Google OAuth 審核狀態）與真 R2 的上傳測試。
