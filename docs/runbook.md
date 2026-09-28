# FTL 競賽池 操作手冊

給之後接手的幹部與系統管理員。寫的是「要做某件事時，照哪幾步做」。程式怎麼寫、為什麼這樣設計，看 `HANDOFF.md` 與 `docs/superpowers/specs/`。

最後更新：2026-09-29

---

## 1. 系統在哪裡

| 東西 | 位置 | 用哪個帳號登入 |
| --- | --- | --- |
| 網站 | https://ftl-casepool.vercel.app | 學校 Google 帳號 |
| 網站主機 | Vercel，專案 `ftl-casepool` | 社團 Google 帳號 |
| 資料庫與登入 | Supabase，專案 `ftl-casepool`（ID `bipdsaqusibgtahvvuxj`，東京） | 社團 Google 帳號 |
| PDF 檔案 | Cloudflare R2，儲存桶 `ftl-casepool`（正式）、`ftl-casepool-test`（測試） | 社團信箱 |
| Google 登入設定 | Google Cloud，專案 `FTL Casepool` → Google Auth Platform | 社團 Google 帳號 |
| 程式碼 | GitHub `Selinaliu12/FTLCasepool` | 目前是 Selina 的 GitHub 帳號 |
| 定時喚醒 | GitHub → Actions → `keep-alive` | 同上 |

社團帳號：`nccufintechlab@gmail.com`。**這個帳號是所有服務的入口，一定要開兩步驟驗證**，密碼與備用碼交接時一起交。

---

## 2. 每學期開始

照這個順序做，全部在網站的「管理員設定」頁。

1. **建立學期**：輸入學期名稱（例如 `115-2`），再打一次名稱確認。
   - 建好後系統會切到新學期，**舊學期的人立刻登不進來**，所以名單要緊接著匯入。
2. **匯入名單**：上傳 CSV（格式見下）。
   - 一學期只能匯入一次。匯入前請再檢查一次信箱有沒有打錯。
3. **填期別**：每一期的截止日期、時間，以及「這期建議交什麼」。
   - 之後任何一期都能改日期或刪除。刪除已經有組別交件的期別，會一起刪掉那些進度與檔案，系統會先列出影響範圍、要你打「刪除」確認。
4. **專案幹部負責組別**：每位專案幹部勾選負責哪幾組。沒有指派的組，頁面上會提醒。
5. **燈號門檻**（通常不用改）：逾期幾小時變紅燈，預設 72 小時。

### 名單 CSV 格式

第一列固定是這七欄：

```
email,姓名,角色,學號,系級,組別,專案名稱
```

| 欄位 | 規則 |
| --- | --- |
| email | 必須是 `@g.nccu.edu.tw` |
| 角色 | 只能填 `專案生`、`專案幹部`、`其他幹部` |
| 學號、系級 | 可以空白，空白會顯示「—」 |
| 組別 | 專案生必填（例如 `第1組`）；幹部一定要空白 |
| 專案名稱 | 選填；同一組有填的列要一致 |

- **同一個人有多個身份**（例如同時是第1組專案生和專案幹部），就寫成多列，每列一個身份。這幾列的姓名、學號、系級要完全一樣。
- **系統管理員不用寫進名單**，見第 4 節。
- 用 Excel 存檔時選「CSV UTF-8」，否則中文會變亂碼。

範例：

```
email,姓名,角色,學號,系級,組別,專案名稱
111306001@g.nccu.edu.tw,王小明,專案生,111306001,資管三,第1組,
111306001@g.nccu.edu.tw,王小明,專案幹部,111306001,資管三,,
112306002@g.nccu.edu.tw,陳小華,專案生,112306002,金融二,第2組,智慧理財
113306003@g.nccu.edu.tw,林小美,其他幹部,113306003,企管一,,
```

---

## 3. 學期中常見的事

| 要做的事 | 怎麼做 |
| --- | --- |
| 同學換組 | 管理員設定 →「換組」，選人和新組別。一個人有多個專案生身份時，每個身份各一個選項 |
| 改某一期的截止日 | 管理員設定 →「期別表」直接改，存檔。準時與否會依新日期重算 |
| 換專案幹部負責的組 | 管理員設定 →「專案幹部負責組別」 |
| 新增比賽 | 任何幹部：競賽大廳 →「新增競賽」，可以先存草稿，確認後發布 |
| **有人學期中加入、或名單信箱打錯** | **目前網站做不到**（一學期只能匯入一次）。要請維護程式的人處理 |

---

## 4. 新增或移除系統管理員

管理員不是在網站裡設定，是寫在 Vercel 的環境變數裡。這樣就算有人拿到網站權限，也無法把自己升成管理員。

1. Vercel → `ftl-casepool` 專案 → **Settings** → **Environment Variables**。
2. 找到 `ADMIN_EMAILS` → 右邊 **⋯** → **Edit**。
3. 值是用英文逗號隔開的學校信箱，不要空格，例如 `114306012@g.nccu.edu.tw,111306099@g.nccu.edu.tw`。加人就在後面加，移除就刪掉。
4. **Save**。
5. **一定要重新部署才會生效**：**Deployments** 分頁 → 最上面那筆 **⋯** → **Redeploy**。

管理員同時也在名單上時，登入後預設是「管理員」身份，可以用頁首的「身份 ▾」切換。

---

## 5. 定時喚醒（不用手動做，但要知道）

Supabase 免費方案**大約一週沒有人使用就會暫停**，暫停後網站打不開。

- GitHub Actions 的 `keep-alive` 每 3 天早上 9 點自動連一次網站的 `/api/health`，它會真的查一次資料庫，讓專案保持醒著。
- 失敗時 GitHub 會寄信給專案擁有者。也可以到 GitHub → **Actions** → `keep-alive` → **Run workflow** 手動跑一次。
- **注意**：GitHub 對 60 天沒有任何程式碼更新的專案，會自動停用定時工作（會先寄信通知）。收到通知時，到 Actions 分頁按「Enable workflow」即可。
- 如果網站還是打不開：登入 Supabase，專案頁如果顯示「Paused」，按 **Resume project**，等幾分鐘就好。

---

## 6. 備份

Supabase 免費方案**沒有可以下載的自動備份**，所以要自己定期匯出。建議**每個月一次、期末一定要做一次**。

需要一台裝了 Node.js 與 Docker Desktop 的電腦（匯出工具在 Docker 裡執行，匯出時 Docker 要開著），先下載程式碼（`git clone https://github.com/Selinaliu12/FTLCasepool.git`，進資料夾後執行 `npm install`）。不需要 `.env.local`。在專案資料夾執行：

```bash
npx supabase login
npx supabase link --project-ref bipdsaqusibgtahvvuxj
npx supabase db dump --linked -f backup-schema.sql
npx supabase db dump --linked --data-only -f backup-data-$(date +%Y%m%d).sql
```

- 產生的 `.sql` 檔含有全社員的姓名、學號、信箱，**只能存在社團帳號的 Google 雲端硬碟私人資料夾**，不要分享連結、不要傳到群組。
- 備份完把電腦上的 `.sql` 檔刪掉。
- PDF 檔案存在 Cloudflare R2，本身有多份備援，不另外備份。

---

## 7. 程式更新怎麼上線

- 程式合併進 GitHub 的 `main` 分支後，Vercel 會自動重新部署，1–2 分鐘後生效。
- 資料庫結構有變動時（`supabase/migrations/` 有新檔案），還要在專案資料夾執行 `npx supabase db push`，並先確認 `link` 的是正式專案。
- 上線後打開 https://ftl-casepool.vercel.app/api/health ，看到 `{"ok":true}` 代表網站與資料庫都正常。

---

## 8. 金鑰放在哪裡

所有金鑰只存在 Vercel 的環境變數裡，**不要寫進程式碼、不要貼在聊天或群組**。

| 環境變數 | 從哪裡拿 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://bipdsaqusibgtahvvuxj.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → Legacy → anon |
| `SUPABASE_SERVICE_ROLE_KEY` | 同上 → service_role（最高權限，外洩要立刻重發） |
| `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` | Cloudflare R2 → 管理 API 權杖（只能存取兩個桶） |
| `R2_BUCKET` | `ftl-casepool` |
| `ADMIN_EMAILS` | 見第 4 節 |

**Vercel 上絕對不能設定** `ENABLE_TEST_LOGIN`、`R2_ENDPOINT`、`R2_REGION`（本機測試專用）。檢查方法：打開 https://ftl-casepool.vercel.app/test-login ，應該是「找不到頁面」。

**金鑰外洩時**：到對應服務重新產生新金鑰 → 更新 Vercel 環境變數 → Redeploy → 刪掉舊金鑰。

---

## 9. 出問題時

| 狀況 | 先檢查 |
| --- | --- |
| 網站整個打不開 | Supabase 是否 Paused（第 5 節）；Vercel 最新一次部署是否失敗 |
| 同學說「你不在本學期名單中」 | 名單上的信箱是否打錯；是不是還沒匯入名單 |
| 同學用 Google 登入後被彈回登入頁 | 是否用了非 `@g.nccu.edu.tw` 的帳號 |
| 上傳 PDF 失敗 | 檔案是否超過 20MB、是不是 PDF；R2 儲存桶的 CORS 是否還允許 `https://ftl-casepool.vercel.app` |
| 網站變慢 | Vercel → Settings → Functions 的區域是否還是東京（`hnd1`） |
