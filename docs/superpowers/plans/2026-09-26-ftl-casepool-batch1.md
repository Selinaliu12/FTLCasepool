# FTL 競賽池 批次 1（第一版）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **TDD 是最高原則**（`~/.claude/policies/testing-policy.md`）：每個行為都是「寫一個失敗測試 → 親眼看到紅 → 最少實作 → 親眼看到綠 → 重構」的垂直切片。紅綠循環只跑當前測試檔；每個 Task 收尾跑一次全套。**禁止先寫完所有測試再寫實作。**
>
> **前端規範**（`~/.claude/policies/frontend-codex.md`）：有畫面的 Task 收尾時，用 `playwright-cli` 截 1280×800 和 375×812 兩張圖自評，至少兩輪；元件一律用 shadcn/ui。

**Goal:** 做出 10/02 上線的第一版：學校 Google 帳號登入、名單分組、第一次登入說明頁、雙週進度與中間週燈號、上傳 2 小時規則、燈號規則、準時率、幹部看板。

**Architecture:** 一個 Next.js 網站（Vercel）＋ Supabase（資料庫、Google 登入、權限規則）＋ Cloudflare R2（PDF）。所有「判斷規則」（燈號、準時率、逾期、2 小時鎖定、CSV 檢查）寫成不碰網路的純函式，放 `src/domain/`，用單元測試鎖死；資料庫權限用 Postgres RLS 規則，用本機 Supabase 做真實邊界測試；上傳 PDF 由瀏覽器直傳 R2，用真實 R2 測試桶做契約測試。燈號在讀取時即時計算，第一版**不需要定時工作**。

**Tech Stack:** Next.js 15（App Router、TypeScript strict）、React 19、Tailwind CSS 4、shadcn/ui、@supabase/ssr、@supabase/supabase-js、Supabase CLI（本機，需要 Docker Desktop）、@aws-sdk/client-s3＋@aws-sdk/s3-request-presigner（R2）、papaparse（CSV）、Vitest、@testing-library/react、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-26-ftl-casepool-design.md`（**第 12 節的補充決定優先於前文**）＋ `PRODUCT.md`（視覺）。

## Global Constraints

- 登入只接受 `@g.nccu.edu.tw` 結尾的 Google 帳號；系統不保管密碼。
- 管理員 email 來自環境變數 `ADMIN_EMAILS`（逗號分隔），不存在名單 CSV 裡。
- 名單 CSV 欄位固定：`email,姓名,角色,組別,專案名稱`；角色只能是 `專案幹部`、`其他幹部`、`專案生`。
- 不在當學期名單上（且不是管理員）的帳號看到：「你不在本學期名單中，請聯絡幹部」，無法進入。
- 只收 PDF，每份最大 20MB（20 × 1024 × 1024 bytes）。
- 上傳滿 2 小時鎖定，之後不能刪除或修改。**繳交時間 = 最後留下那份 PDF 的上傳時間。**
- 上傳頁面固定顯示：「⚠️ 替換檔案後，繳交時間以新檔案為準。」
- 系統判定燈：逾期未滿 72 小時 → 黃；滿 72 小時以上 → 紅（72 為管理員可調設定值 `red_after_hours`）；都沒有 → 綠。
- 顯示燈 = 組員回報燈與系統判定燈中較嚴重者，並標示來源。
- 「連續兩次黃燈轉紅燈」不採用。
- 時區一律台北（UTC+8，無日光節約）。伺服器（Vercel）跑在 UTC，程式不得依賴伺服器時區。
- 權限表（規格第 3 節）：其他幹部看得到所有組的燈號、階段、準時率，**看不到**三句話、PDF、紅燈補充說明；專案生只看自己組。
- 中間週燈號選填、沒有截止日；點紅燈必須補一句卡在哪裡。
- 視覺代幣照 `PRODUCT.md`：主色 `#1668E3`、文字 `#0B1F3A`、底 `#FBFAFF`、字體 Huninn／Outfit／IBM Plex Mono、圓角 20px。

## Review Focus

以下五種情況規格沒寫，但真人最容易踩到；每一條都已經在對應 Task 加了測試。

1. **Excel 存出來的 CSV**（開頭有 BOM、email 有大寫或前後空白）→ 匯入後同一個人仍然登得進去。測試在 Task 3。
2. **23:59 截止、23:59:40 交出** → 使用者預期算準時。截止時間代表「那一分鐘結束」。測試在 Task 2（時間函式）與 Task 11（準時率）。
3. **準時交出後，在 2 小時內、但已過截止時才替換 PDF** → 依規格繳交時間以新檔為準，變成逾期；畫面要明確提示，不能默默變。測試在 Task 9。
4. **同一組兩個人同時按送出同一期** → 只留一份，第二個人看到「這一期剛剛已經有組員交了，請重新整理」，不是錯誤頁。測試在 Task 8。
5. **伺服器在 UTC** → 「剩幾天」與「逾期幾天」在台北凌晨 0–8 點不會算錯一天。所有單元測試以 `TZ=UTC` 執行，時間函式另有跨日測試。測試在 Task 2。

---

## 檔案地圖

```
src/
  domain/                 純規則，不碰網路、不碰資料庫（全部單元測試）
    time.ts               台北時間：截止時間解析、剩幾天、格式化
    roster-csv.ts         名單 CSV 解析與檢查
    access.ts             登入後能不能進、是什麼身分
    pdf.ts                PDF 檔名／大小／檔頭檢查
    lock.ts               2 小時鎖定
    progress.ts           雙週進度與中間週燈號表單檢查
    lights.ts             系統判定燈、組員回報燈、顯示燈
    on-time.ts            準時率
    dashboard.ts          組別卡片組裝與排序
  server/                 會碰網路的程式
    env.ts                讀環境變數
    supabase.ts           兩種資料庫連線：使用者身分／服務身分
    session.ts            取得目前登入者的 Access
    r2.ts                 R2 預簽網址、檢查已上傳檔案
    actions/*.ts          表單送出後在伺服器執行的動作
    queries/*.ts          頁面讀資料
  app/                    頁面
    login/  auth/callback/  not-in-roster/  welcome/
    (app)/layout.tsx      必須登入＋已按「我已了解」
    (app)/page.tsx        依身分導向
    (app)/dashboard/      幹部看板
    (app)/my-group/       學生組頁、交雙週進度、點燈號
    (app)/admin/          學期、名單、期別、幹部負責組別、燈號門檻
    test-login/           只在本機測試開啟的登入捷徑
  components/             shadcn/ui 元件＋ LightBadge、GroupCard
supabase/
  migrations/             資料表與權限規則
  seed.sql                本機測試資料
tests/
  integration/            打本機 Supabase、真實 R2 測試桶
  e2e/                    Playwright 使用者流程
```

---

## Task 0：帳號與工具準備（你來做，不寫程式）

這些只有你能做（要綁卡、要用社團帳號登入）。計畫裡標出每一項**最晚哪個 Task 前要好**。

- [ ] **0.1 安裝 Docker Desktop**（個人免費），開啟後保持執行。**Task 1 前要好。**
- [ ] **0.2 用社團 Google 帳號開 Supabase 正式專案**（免費方案，區域選 Tokyo 或 Singapore），把 Project URL、anon key、service_role key 交給執行者放進 Vercel（不要貼在聊天裡）。**Task 13 前要好。**
- [ ] **0.3 Google Cloud 建 OAuth 用戶端**（社團帳號），授權重新導向 URI 填 Supabase 給的 callback 網址。**Task 13 前要好。**
- [ ] **0.4 Cloudflare R2**：社團帳號開通並綁卡，建兩個桶：`ftl-casepool`（正式）、`ftl-casepool-test`（測試）；建一組只能存取這兩個桶的 API token；桶的 CORS 允許網站網域與 `http://localhost:3000` 的 `PUT`。**Task 7 前要好。**
- [ ] **0.5 Vercel**：社團帳號登入，連結 GitHub 的 `Selinaliu12/FTLCasepool`。**Task 13 前要好。**
- [ ] **0.6 學期資料**：本學期名稱（例如 `115-1`）、名單 CSV、上線後各期雙週進度截止日期與時間、每位專案幹部負責哪幾組。**Task 13 前要好。**

**你會看到什麼／怎麼驗收：** Docker Desktop 圖示顯示 running；R2 後台看得到兩個桶；Supabase 後台看得到專案。

---

## Task 1：專案骨架＋「沒登入會被帶到登入頁」

**Files:**
- Create: Next.js 專案骨架、`vitest.config.ts`、`playwright.config.ts`、`src/app/globals.css`（PRODUCT.md 的設計代幣）、`src/app/login/page.tsx`、`src/middleware.ts`、`src/server/supabase.ts`、`src/server/env.ts`、`supabase/`（`npx supabase init`）、`.env.example`、`.gitignore`
- Test: `tests/e2e/login-redirect.spec.ts`

**Interfaces:**
- Produces: `createServerSupabase(): Promise<SupabaseClient>`（使用者身分，受 RLS 限制）、`createServiceSupabase(): SupabaseClient`（服務身分，只在管理員動作與測試使用）、`env`（`{ supabaseUrl, supabaseAnonKey, supabaseServiceKey, adminEmails, r2..., enableTestLogin }`）、npm scripts：`test`、`test:unit`、`test:integration`、`test:e2e`。

- [ ] **Step 1: 把現有文件先提交到 main，再開分支**

```bash
git add docs PRODUCT.md HANDOFF.md
git commit -m "docs: spec v5.0, batch 1 plan, PRODUCT.md, HANDOFF.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git switch -c feat/batch1
```

- [ ] **Step 2: 建 Next.js 骨架**（資料夾非空，先建在暫存子資料夾再搬出來）

```bash
npx create-next-app@latest .scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
rsync -a .scaffold/ ./ --exclude .git && rm -rf .scaffold
npm i @supabase/ssr @supabase/supabase-js papaparse @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @playwright/test @types/papaparse supabase
npx playwright install chromium
npx shadcn@latest init -d
npx shadcn@latest add button input textarea label card badge dialog table radio-group alert sonner
npx supabase init
```

- [ ] **Step 3: 測試設定**

`vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      { extends: true, test: { name: "component", include: ["src/**/*.test.tsx"], environment: "jsdom" } },
      { extends: true, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 30_000, fileParallelism: false } },
    ],
  },
});
```

`package.json` scripts（`TZ=UTC` 模擬 Vercel，Review Focus 第 5 條）：

```json
{
  "test": "npm run test:unit && npm run test:integration && npm run test:e2e",
  "test:unit": "TZ=UTC vitest run --project unit --project component --reporter=dot",
  "test:integration": "TZ=UTC vitest run --project integration --reporter=dot",
  "test:e2e": "playwright test --reporter=line"
}
```

`playwright.config.ts`：

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3000", timezoneId: "Asia/Taipei", locale: "zh-TW" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, env: { ENABLE_TEST_LOGIN: "true" } },
});
```

- [ ] **Step 4: 寫失敗測試** `tests/e2e/login-redirect.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("沒登入打開首頁，會被帶到登入頁並看到 Google 登入按鈕", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "用學校 Google 帳號登入" })).toBeVisible();
});
```

- [ ] **Step 5: 跑測試確認紅**

Run: `npx supabase start && npx playwright test tests/e2e/login-redirect.spec.ts`
Expected: FAIL — URL 停在 `/`，找不到按鈕。

- [ ] **Step 6: 最少實作**

`src/server/supabase.ts`：

```ts
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "./env";

export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}

export function createServiceSupabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
}
```

`src/server/env.ts`：

```ts
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}
export const env = {
  get supabaseUrl() { return required("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabaseAnonKey() { return required("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
  get supabaseServiceKey() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get adminEmails() { return process.env.ADMIN_EMAILS ?? ""; },
  get enableTestLogin() { return process.env.ENABLE_TEST_LOGIN === "true" && process.env.VERCEL !== "1"; },
  get r2() {
    return {
      accountId: required("R2_ACCOUNT_ID"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      bucket: required("R2_BUCKET"),
    };
  },
};
```

`src/middleware.ts`：用 `@supabase/ssr` 在 middleware 更新 session；沒有使用者且路徑不在 `/login`、`/auth/callback`、`/not-in-roster`、`/test-login` 時 `redirect("/login")`。

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/auth/callback", "/not-in-roster", "/test-login"];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && !PUBLIC.some((p) => req.nextUrl.pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

`src/app/login/page.tsx`：一張置中卡片，標題「FTL 競賽池」，一顆 shadcn `Button`「用學校 Google 帳號登入」，按下呼叫 `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { hd: "g.nccu.edu.tw", prompt: "select_account" } } })`。

`src/app/globals.css`：把 `PRODUCT.md` 的代幣寫成 CSS 變數，並對應到 shadcn 的 `--primary`、`--background`、`--foreground`、`--border`、`--radius`；`<head>` 載入 Google Fonts `Huninn`、`Outfit`、`IBM Plex Mono`。

`.env.example`：列出 `env.ts` 用到的所有變數名稱，不含值。`.gitignore` 加 `.env*.local`、`.screenshots/`、`/test-results`、`/playwright-report`。

- [ ] **Step 7: 跑測試確認綠**

Run: `npx playwright test tests/e2e/login-redirect.spec.ts`
Expected: PASS

- [ ] **Step 8: 截圖自評（前端規範硬規則一）**：登入頁桌機／手機各一張，存 `.screenshots/`，逐項自評，至少兩輪。

- [ ] **Step 9: 全套＋提交**

```bash
npm run test:unit && npm run test:e2e
git add -A && git commit -m "chore: scaffold Next.js + Supabase + test harness, login redirect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**你會看到什麼／怎麼驗收：** 在本機打開 `http://localhost:3000`，會自動跳到登入頁，看到社團藍色的「用學校 Google 帳號登入」按鈕，字體是社團網站那套圓體。按鈕在本機還不能真的登入（Google 設定在 Task 13）。

---

## Task 2：台北時間規則

**Files:**
- Create: `src/domain/time.ts`
- Test: `src/domain/time.test.ts`

**Interfaces:**
- Produces:
  - `parseTaipeiDeadline(date: string, time: string): Date` — `"2026-10-16","23:59"` → 那一分鐘**結束**的瞬間（`2026-10-16T23:59:59.999+08:00`）
  - `taipeiDateKey(d: Date): string` — `"YYYY-MM-DD"`
  - `daysUntil(deadline: Date, now: Date): number` — 以台北日曆日相減；今天截止為 0，已過為負數
  - `formatTaipei(d: Date): string` — `"10/16（五）23:59"`

每個行為一個紅綠循環：

- [ ] **Step 1: 寫失敗測試（截止時間代表那一分鐘結束）**

```ts
import { describe, it, expect } from "vitest";
import { parseTaipeiDeadline } from "./time";

describe("parseTaipeiDeadline", () => {
  it("23:59 截止代表台北 23:59:59.999，也就是 UTC 15:59:59.999", () => {
    expect(parseTaipeiDeadline("2026-10-16", "23:59").toISOString()).toBe("2026-10-16T15:59:59.999Z");
  });
});
```

- [ ] **Step 2: 跑** `TZ=UTC npx vitest run src/domain/time.test.ts` → Expected: FAIL（`parseTaipeiDeadline` 不存在）
- [ ] **Step 3: 實作**

```ts
export function parseTaipeiDeadline(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("日期或時間格式錯誤");
  const d = new Date(`${date}T${time}:59.999+08:00`);
  if (Number.isNaN(d.getTime())) throw new Error("日期或時間格式錯誤");
  return d;
}
```

- [ ] **Step 4: 跑同一檔** → PASS
- [ ] **Step 5: 寫失敗測試（格式錯誤要擋）**

```ts
it("格式錯誤直接丟錯，不會默默變成別的日期", () => {
  expect(() => parseTaipeiDeadline("2026/10/16", "23:59")).toThrow("日期或時間格式錯誤");
  expect(() => parseTaipeiDeadline("2026-13-40", "23:59")).toThrow("日期或時間格式錯誤");
});
```

- [ ] **Step 6: 跑** → 預期第一個已綠、第二個紅（`2026-13-40` 會被 JS 算成 Invalid Date 已擋；若已綠則此步確認行為並繼續）。若紅，補月份／日期範圍檢查 → 綠。
- [ ] **Step 7: 寫失敗測試（剩幾天用台北日曆，Review Focus 5）**

```ts
import { daysUntil } from "./time";

describe("daysUntil", () => {
  it("台北 10/15 早上 7 點（UTC 還是 10/14）看 10/16 截止，剩 1 天", () => {
    const now = new Date("2026-10-14T23:00:00Z"); // 台北 10/15 07:00
    expect(daysUntil(parseTaipeiDeadline("2026-10-16", "23:59"), now)).toBe(1);
  });
  it("當天截止是 0，昨天截止是 -1", () => {
    const now = new Date("2026-10-16T02:00:00Z"); // 台北 10/16 10:00
    expect(daysUntil(parseTaipeiDeadline("2026-10-16", "23:59"), now)).toBe(0);
    expect(daysUntil(parseTaipeiDeadline("2026-10-15", "23:59"), now)).toBe(-1);
  });
});
```

- [ ] **Step 8: 跑** → FAIL
- [ ] **Step 9: 實作**

```ts
const TAIPEI_MS = 8 * 60 * 60 * 1000;
export function taipeiDateKey(d: Date): string {
  return new Date(d.getTime() + TAIPEI_MS).toISOString().slice(0, 10);
}
export function daysUntil(deadline: Date, now: Date): number {
  const a = Date.parse(`${taipeiDateKey(now)}T00:00:00Z`);
  const b = Date.parse(`${taipeiDateKey(deadline)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}
```

- [ ] **Step 10: 跑** → PASS
- [ ] **Step 11: 寫失敗測試（顯示格式）**

```ts
import { formatTaipei } from "./time";
it("顯示成 10/16（五）23:59，不受伺服器時區影響", () => {
  expect(formatTaipei(parseTaipeiDeadline("2026-10-16", "23:59"))).toBe("10/16（五）23:59");
});
```

- [ ] **Step 12: 跑** → FAIL；**Step 13: 實作**

```ts
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export function formatTaipei(d: Date): string {
  const t = new Date(d.getTime() + TAIPEI_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCMonth() + 1}/${p(t.getUTCDate())}（${WEEK[t.getUTCDay()]}）${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}
```

- [ ] **Step 14: 跑** → PASS；重構（檢查命名、無重複）；`npm run test:unit` 全綠
- [ ] **Step 15: 提交** `git commit -m "feat(domain): Taipei deadline and day math"`（附 Co-Authored-By 行，以下同）

**你會看到什麼／怎麼驗收：** 沒有畫面。執行者回報 `npm run test:unit` 的結果，裡面包含「台北早上 7 點剩幾天」「23:59 截止」這些測試名稱都是綠的。

---

## Task 3：名單 CSV 解析

**Files:**
- Create: `src/domain/roster-csv.ts`
- Test: `src/domain/roster-csv.test.ts`

**Interfaces:**
- Produces:

```ts
export type Role = "pm" | "officer" | "student";
export type RosterRow = { email: string; name: string; role: Role; group: string | null; projectName: string | null };
export type ParseResult = { ok: true; rows: RosterRow[] } | { ok: false; errors: string[] };
export function parseRosterCsv(text: string): ParseResult;
```

錯誤訊息一律標列號（標題列算第 1 列），讓管理員知道去哪一列改。

- [ ] **Step 1: 失敗測試（正常名單）**

```ts
import { describe, it, expect } from "vitest";
import { parseRosterCsv } from "./roster-csv";

const HEADER = "email,姓名,角色,組別,專案名稱";

describe("parseRosterCsv", () => {
  it("讀出專案生、專案幹部、其他幹部", () => {
    const r = parseRosterCsv([HEADER,
      "a@g.nccu.edu.tw,王小明,專案生,第1組,智慧記帳",
      "p@g.nccu.edu.tw,陳幹部,專案幹部,,",
      "o@g.nccu.edu.tw,林公關,其他幹部,,"].join("\n"));
    expect(r).toEqual({ ok: true, rows: [
      { email: "a@g.nccu.edu.tw", name: "王小明", role: "student", group: "第1組", projectName: "智慧記帳" },
      { email: "p@g.nccu.edu.tw", name: "陳幹部", role: "pm", group: null, projectName: null },
      { email: "o@g.nccu.edu.tw", name: "林公關", role: "officer", group: null, projectName: null },
    ]});
  });
});
```

- [ ] **Step 2: 跑** `TZ=UTC npx vitest run src/domain/roster-csv.test.ts` → FAIL
- [ ] **Step 3: 實作**

```ts
import Papa from "papaparse";

const ROLE: Record<string, Role> = { 專案幹部: "pm", 其他幹部: "officer", 專案生: "student" };
const COLS = ["email", "姓名", "角色", "組別", "專案名稱"] as const;

export function parseRosterCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const errors: string[] = [];
  const rows: RosterRow[] = [];
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const v = (k: (typeof COLS)[number]) => (raw[k] ?? "").trim();
    const role = ROLE[v("角色")];
    if (!role) { errors.push(`第 ${line} 列：角色「${v("角色")}」不是 專案幹部／其他幹部／專案生`); return; }
    const group = v("組別") || null;
    rows.push({ email: v("email"), name: v("姓名"), role, group, projectName: v("專案名稱") || null });
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}
```

- [ ] **Step 4: 跑** → PASS
- [ ] **Step 5: 失敗測試（Review Focus 1：Excel 的 BOM、大寫 email、前後空白）**

```ts
it("Excel 存出來的檔案（BOM、大寫、空白）也能讀，email 一律轉小寫", () => {
  const r = parseRosterCsv("﻿" + HEADER + "\n  A.Wang@G.NCCU.edu.tw , 王小明 ,專案生, 第1組 ,智慧記帳\r\n");
  expect(r.ok && r.rows[0]).toEqual({ email: "a.wang@g.nccu.edu.tw", name: "王小明", role: "student", group: "第1組", projectName: "智慧記帳" });
});
```

- [ ] **Step 6: 跑** → FAIL（BOM 讓第一欄名稱變成 `﻿email`、email 未轉小寫）
- [ ] **Step 7: 實作**：`text.replace(/^﻿/, "")`；email 用 `v("email").toLowerCase()`。
- [ ] **Step 8: 跑** → PASS
- [ ] **Step 9: 失敗測試（缺欄位）**

```ts
it("標題少了欄位，直接說少哪一欄", () => {
  expect(parseRosterCsv("email,姓名,角色\na@g.nccu.edu.tw,王,專案生")).toEqual({ ok: false, errors: ["缺少欄位：組別、專案名稱"] });
});
```

- [ ] **Step 10: 跑** → FAIL；**Step 11: 實作**：解析後檢查 `parsed.meta.fields` 是否包含 `COLS` 全部，缺的用「、」串起來，直接回傳。**Step 12: 跑** → PASS
- [ ] **Step 13: 失敗測試（逐列檢查）**

```ts
it("一次列出所有有問題的列", () => {
  const r = parseRosterCsv([HEADER,
    "a@gmail.com,甲,專案生,第1組,X",
    "b@g.nccu.edu.tw,乙,專案生,,",
    "c@g.nccu.edu.tw,丙,專案生,第1組,X",
    "C@g.nccu.edu.tw,丙二,專案生,第2組,Y",
    "d@g.nccu.edu.tw,丁,專案生,第1組,Z"].join("\n"));
  expect(r).toEqual({ ok: false, errors: [
    "第 2 列：email 必須是 @g.nccu.edu.tw",
    "第 3 列：專案生一定要填組別與專案名稱",
    "第 5 列：email c@g.nccu.edu.tw 和第 4 列重複",
    "第 6 列：第1組的專案名稱和前面不一致（X／Z）",
  ]});
});
```

- [ ] **Step 14: 跑** → FAIL；**Step 15: 實作**：在逐列迴圈加上四項檢查（網域、專案生必填組別與專案名稱、email 重複記第一次出現的列號、同組專案名稱一致）；幹部列若填了組別也回錯：「第 N 列：幹部不屬於任何一組，組別請留空」。**Step 16: 跑** → PASS
- [ ] **Step 17: 再補一個失敗測試**：幹部填了組別 → 錯誤訊息如上；跑紅 → 實作已含則確認綠。
- [ ] **Step 18: 重構＋`npm run test:unit`＋提交** `feat(domain): roster CSV parsing with row-numbered errors`

**你會看到什麼／怎麼驗收：** 沒有畫面。測試名稱裡看得到「Excel 存出來的檔案也能讀」「一次列出所有有問題的列」都綠。Task 5 做出匯入畫面後，你可以拿真的名單試。

---

## Task 4：資料表、權限規則與「誰能進來」

這是第一版最重要的安全切片：**權限在資料庫裡擋，不只在畫面上藏。**

**Files:**
- Create: `supabase/migrations/20260927000001_init.sql`、`supabase/seed.sql`、`src/domain/access.ts`、`src/server/session.ts`、`src/app/auth/callback/route.ts`、`src/app/not-in-roster/page.tsx`、`src/app/test-login/route.ts`、`src/app/(app)/layout.tsx`、`src/app/(app)/page.tsx`、`tests/integration/helpers.ts`
- Test: `src/domain/access.test.ts`、`tests/integration/rls.test.ts`、`tests/e2e/access.spec.ts`

**Interfaces:**
- Consumes: `Role`（Task 3）
- Produces:

```ts
// src/domain/access.ts
export type Member = { id: string; semesterId: string; email: string; name: string; role: Role; groupId: string | null };
export type Access =
  | { kind: "wrong_domain" }
  | { kind: "no_semester"; isAdmin: boolean }
  | { kind: "not_in_roster" }
  | { kind: "ok"; email: string; isAdmin: boolean; member: Member | null; semesterId: string };
export function parseAdminEmails(raw: string): string[];
export function resolveAccess(email: string, ctx: { adminEmails: string[]; semesterId: string | null; member: Member | null }): Access;
// src/server/session.ts
export async function getAccess(): Promise<Access>;
export async function requireOk(): Promise<Extract<Access, { kind: "ok" }>>; // 否則 redirect
// tests/integration/helpers.ts
export async function resetDb(): Promise<void>;
export async function seedSemester(): Promise<{ semesterId: string; groupA: string; groupB: string; lineA: string; lineB: string; periodIds: string[] }>;
export async function clientAs(email: string): Promise<SupabaseClient>; // 以該 email 登入的使用者連線
```

資料表（`supabase/migrations/20260927000001_init.sql`）：

```sql
create type role as enum ('pm','officer','student');
create type light as enum ('green','yellow','red');

create table semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_current boolean not null default false,
  red_after_hours int not null default 72 check (red_after_hours between 1 and 720),
  created_at timestamptz not null default now()
);
create unique index one_current_semester on semesters (is_current) where is_current;

create table groups (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  name text not null,
  project_name text not null,
  unique (semester_id, name)
);

create table members (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  email text not null check (email = lower(email) and email like '%@g.nccu.edu.tw'),
  name text not null,
  role role not null,
  group_id uuid references groups on delete restrict,
  check ((role = 'student') = (group_id is not null)),
  unique (semester_id, email)
);

create table pm_assignments (
  pm_member_id uuid not null references members on delete cascade,
  group_id uuid not null references groups on delete cascade,
  primary key (pm_member_id, group_id)
);

create table acknowledgements (
  semester_id uuid not null references semesters on delete cascade,
  email text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (semester_id, email)
);

create table lines (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups on delete cascade,
  kind text not null check (kind in ('project','competition')),
  created_at timestamptz not null default now()
);
create unique index one_project_line on lines (group_id) where kind = 'project';

create table periods (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references semesters on delete cascade,
  seq int not null,
  deadline timestamptz not null,
  unique (semester_id, seq)
);

create table progress_reports (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references lines on delete cascade,
  period_id uuid not null references periods on delete cascade,
  light light not null,
  did text not null check (length(trim(did)) > 0),
  blocked text not null check (length(trim(blocked)) > 0),
  next_steps text not null check (length(trim(next_steps)) > 0),
  submitted_by text not null,
  pdf_key text not null,
  pdf_size int not null check (pdf_size between 1 and 20971520),
  pdf_uploaded_at timestamptz not null,
  pdf_uploaded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, period_id)
);

create table checkins (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references lines on delete cascade,
  light light not null,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (light <> 'red' or length(trim(coalesce(note,''))) > 0)
);
```

權限輔助函式與 RLS（同一個 migration 檔）：

```sql
create function me() returns members language sql stable security definer set search_path = public as $$
  select m.* from members m join semesters s on s.id = m.semester_id
  where s.is_current and m.email = lower(auth.jwt() ->> 'email') limit 1
$$;
create function my_group() returns uuid language sql stable as $$ select (me()).group_id $$;
create function is_staff() returns boolean language sql stable as $$ select coalesce((me()).role in ('pm','officer'), false) $$;
create function is_pm() returns boolean language sql stable as $$ select coalesce((me()).role = 'pm', false) $$;
create function line_group(l uuid) returns uuid language sql stable security definer set search_path = public as $$ select group_id from lines where id = l $$;
-- 看得到內容（三句話、PDF、紅燈說明）：自己組員＋專案幹部。管理員走伺服器服務身分，不經過這些規則。
create function can_read_content(l uuid) returns boolean language sql stable as $$ select is_pm() or line_group(l) = my_group() $$;
-- 看得到狀態（燈號、繳交時間）：所有幹部＋自己組員
create function can_read_status(l uuid) returns boolean language sql stable as $$ select is_staff() or line_group(l) = my_group() $$;

alter table semesters enable row level security;
alter table groups enable row level security;
alter table members enable row level security;
alter table pm_assignments enable row level security;
alter table acknowledgements enable row level security;
alter table lines enable row level security;
alter table periods enable row level security;
alter table progress_reports enable row level security;
alter table checkins enable row level security;

create policy read_current_semester on semesters for select using (is_current);
create policy read_groups on groups for select using (is_staff() or id = my_group());
create policy read_members on members for select using (is_staff() or email = (me()).email or group_id = my_group());
create policy read_pm on pm_assignments for select using (is_staff() or group_id = my_group());
create policy read_own_ack on acknowledgements for select using (email = lower(auth.jwt() ->> 'email'));
create policy read_lines on lines for select using (can_read_status(id));
create policy read_periods on periods for select using (me() is not null);
create policy read_reports on progress_reports for select using (can_read_content(line_id));
create policy read_checkins on checkins for select using (can_read_content(line_id));

-- 狀態視圖：不含三句話、PDF、說明文字，給看板用
create view line_light_events with (security_invoker = false) as
  select line_id, light, pdf_uploaded_at as at, period_id from progress_reports where can_read_status(line_id)
  union all
  select line_id, light, created_at as at, null from checkins where can_read_status(line_id);
```

寫入（新增、修改、刪除）一律**不開放**給使用者連線；全部經由伺服器動作（Task 8–10）以服務身分執行，並在動作裡先用 `requireOk()` 檢查身分。這樣寫入規則只有一個地方，也好測。

- [ ] **Step 1: 失敗測試（access：網域）** `src/domain/access.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolveAccess, parseAdminEmails } from "./access";
const student = { id: "m1", semesterId: "s1", email: "a@g.nccu.edu.tw", name: "甲", role: "student" as const, groupId: "g1" };

describe("resolveAccess", () => {
  it("非學校帳號一律擋下", () => {
    expect(resolveAccess("a@gmail.com", { adminEmails: [], semesterId: "s1", member: null })).toEqual({ kind: "wrong_domain" });
  });
});
```

- [ ] **Step 2: 跑** `TZ=UTC npx vitest run src/domain/access.test.ts` → FAIL；**Step 3: 實作** `resolveAccess` 第一個分支（`!email.toLowerCase().endsWith("@g.nccu.edu.tw")`）；**Step 4:** → PASS
- [ ] **Step 5: 失敗測試（不在名單）**

```ts
it("學校帳號但不在名單、也不是管理員 → not_in_roster", () => {
  expect(resolveAccess("x@g.nccu.edu.tw", { adminEmails: [], semesterId: "s1", member: null })).toEqual({ kind: "not_in_roster" });
});
```

→ 跑紅 → 實作 → 跑綠。

- [ ] **Step 6: 失敗測試（管理員不在名單也能進；還沒有學期時管理員能進、其他人不能）**

```ts
it("管理員不在名單也能進（要先進來才能匯入名單）", () => {
  expect(resolveAccess("Admin@g.nccu.edu.tw", { adminEmails: ["admin@g.nccu.edu.tw"], semesterId: "s1", member: null }))
    .toEqual({ kind: "ok", email: "admin@g.nccu.edu.tw", isAdmin: true, member: null, semesterId: "s1" });
});
it("還沒有學期：管理員 no_semester(isAdmin=true)，其他人 no_semester(isAdmin=false)", () => {
  expect(resolveAccess("admin@g.nccu.edu.tw", { adminEmails: ["admin@g.nccu.edu.tw"], semesterId: null, member: null })).toEqual({ kind: "no_semester", isAdmin: true });
  expect(resolveAccess("a@g.nccu.edu.tw", { adminEmails: [], semesterId: null, member: null })).toEqual({ kind: "no_semester", isAdmin: false });
});
it("名單上的人 → ok，且帶著 member", () => {
  expect(resolveAccess("a@g.nccu.edu.tw", { adminEmails: [], semesterId: "s1", member: student }))
    .toEqual({ kind: "ok", email: "a@g.nccu.edu.tw", isAdmin: false, member: student, semesterId: "s1" });
});
it("ADMIN_EMAILS 容忍空白與大寫", () => {
  expect(parseAdminEmails(" A@g.nccu.edu.tw, b@g.nccu.edu.tw ,")).toEqual(["a@g.nccu.edu.tw", "b@g.nccu.edu.tw"]);
});
```

一次加一個 `it`，每個都紅 → 實作 → 綠。完成後的實作：

```ts
export function parseAdminEmails(raw: string) {
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export function resolveAccess(rawEmail: string, ctx: { adminEmails: string[]; semesterId: string | null; member: Member | null }): Access {
  const email = rawEmail.trim().toLowerCase();
  if (!email.endsWith("@g.nccu.edu.tw")) return { kind: "wrong_domain" };
  const isAdmin = ctx.adminEmails.includes(email);
  if (!ctx.semesterId) return { kind: "no_semester", isAdmin };
  if (!ctx.member && !isAdmin) return { kind: "not_in_roster" };
  return { kind: "ok", email, isAdmin, member: ctx.member, semesterId: ctx.semesterId };
}
```

- [ ] **Step 7: 寫 migration 與 helpers**（上方 SQL；`tests/integration/helpers.ts` 用服務身分清空資料表、建立 `115-1` 學期、第1組／第2組、各一條專案線、兩期；`clientAs(email)` 用 `supabase.auth.admin.createUser({ email, password, email_confirm: true })` 建本機測試帳號後 `signInWithPassword` 回傳使用者連線。成員：`a1@`（第1組專案生）、`b1@`（第2組專案生）、`pm@`（專案幹部）、`off@`（其他幹部）。服務身分插入一筆第1組的 `progress_reports` 與一筆紅燈 `checkins`）。
- [ ] **Step 8: 失敗測試（真實邊界：學生看不到別組內容）** `tests/integration/rls.test.ts`

```ts
import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";

let seed: Awaited<ReturnType<typeof seedSemester>>;
beforeAll(async () => { await resetDb(); seed = await seedSemester(); });

describe("RLS：進度內容", () => {
  it("第2組學生讀不到第1組的三句話與 PDF", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data, error } = await db.from("progress_reports").select("did, pdf_key").eq("line_id", seed.lineA);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 9: 跑** `npx supabase db reset && TZ=UTC npx vitest run --project integration tests/integration/rls.test.ts`
  Expected: 若先前沒套 migration 則 FAIL（表不存在）。套上 migration 後 → PASS。**這個測試要故意驗證一次會紅**：暫時把 `read_reports` 改成 `using (true)`，跑一次看到紅，再改回來看到綠，確認測試真的有在擋。
- [ ] **Step 10: 逐一加以下 `it`，每個都走紅→綠**（驗證方式同上：先讓規則錯一次看到紅）：
  - 「第1組學生讀得到自己組的三句話」
  - 「其他幹部讀不到任何組的三句話與紅燈說明，但從 `line_light_events` 讀得到各組燈號與時間」
  - 「專案幹部讀得到所有組的三句話」（規格：專案幹部看得到所有組）
  - 「學生從 `line_light_events` 只讀得到自己組」
  - 「不在名單上的學校帳號什麼都讀不到（periods 也是空的）」
  - 「使用者連線直接 insert／update／delete `progress_reports` 一律失敗」
- [ ] **Step 11: `src/server/session.ts`**：用 `createServerSupabase().auth.getUser()` 取 email；用服務身分查 `semesters where is_current` 與 `members where semester_id and email`；呼叫 `resolveAccess`。`requireOk()`：`wrong_domain` → 登出後導 `/login?error=domain`；`not_in_roster` → `/not-in-roster`；`no_semester` → 管理員 `/admin`，其他人顯示「本學期尚未開放」。
- [ ] **Step 12: `src/app/test-login/route.ts`**：`if (!env.enableTestLogin) return new Response(null, { status: 404 })`；否則讀 `?email=`，以本機測試密碼登入並設 cookie，導回 `/`。並加單元測試 `src/server/env.test.ts`：「`VERCEL=1` 時即使 `ENABLE_TEST_LOGIN=true`，`enableTestLogin` 仍為 false」（紅→綠）。
- [ ] **Step 13: 失敗 E2E** `tests/e2e/access.spec.ts`

```ts
import { test, expect } from "@playwright/test";
test("不在名單上的學校帳號看到提示、進不去", async ({ page }) => {
  await page.goto("/test-login?email=stranger@g.nccu.edu.tw");
  await expect(page.getByText("你不在本學期名單中，請聯絡幹部")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/not-in-roster/);
});
```

跑紅 → 做 `/auth/callback`（交換 code、呼叫 `getAccess` 決定去哪）、`/not-in-roster` 頁、`(app)/layout.tsx`（呼叫 `requireOk()`）→ 跑綠。E2E 前用 `tests/e2e/global-setup.ts` 呼叫 `resetDb()`＋`seedSemester()`。

- [ ] **Step 14: 全套＋截圖自評（not-in-roster 頁）＋提交** `feat: schema, RLS, access resolution`

**你會看到什麼／怎麼驗收：** 用一個不在名單上的測試帳號登入，看到「你不在本學期名單中，請聯絡幹部」，手動打網址也進不去。執行者會附上權限測試清單（誰讀得到什麼），每一條都要綠，而且每一條都有「先故意弄壞看到紅」的紀錄。

---

## Task 5：管理員：建學期、匯入名單、填期別、指派專案幹部、調燈號門檻

**Files:**
- Create: `src/app/(app)/admin/page.tsx`、`src/app/(app)/admin/roster-import.tsx`、`src/app/(app)/admin/periods-form.tsx`、`src/app/(app)/admin/pm-assign.tsx`、`src/app/(app)/admin/settings-form.tsx`、`src/server/actions/admin.ts`
- Test: `tests/integration/admin-actions.test.ts`、`src/app/(app)/admin/periods-form.test.tsx`、`tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `parseRosterCsv`（Task 3）、`parseTaipeiDeadline`（Task 2）、`requireOk`（Task 4）
- Produces（伺服器動作，每個第一行都是 `requireAdmin()`，不是管理員丟 `Error("只有系統管理員可以這樣做")`）：

```ts
export async function createSemester(name: string): Promise<{ semesterId: string }>;            // 設為本學期，其他學期 is_current=false
export async function importRoster(semesterId: string, csv: string): Promise<{ ok: true; imported: number } | { ok: false; errors: string[] }>;
export async function savePeriods(semesterId: string, rows: { date: string; time: string }[]): Promise<{ ok: true } | { ok: false; errors: string[] }>;
export async function setPmGroups(pmMemberId: string, groupIds: string[]): Promise<void>;
export async function setRedAfterHours(semesterId: string, hours: number): Promise<void>;
export async function moveMember(memberId: string, toGroupId: string): Promise<void>;              // 學期中換組
```

每個動作一個紅綠循環（integration 測試，以服務身分驗證資料庫結果）：

- [ ] **Step 1: 失敗測試：非管理員呼叫任何動作都被拒**（用 `vi.mock("@/server/session")` 讓 `getAccess` 回傳一般學生 → 期待丟出「只有系統管理員可以這樣做」）→ 紅 → 實作 `requireAdmin()` → 綠
- [ ] **Step 2: 失敗測試：`importRoster` 建立組、專案線、成員**

```ts
it("匯入後：2 組、每組 1 條專案線、成員歸組", async () => {
  const { semesterId } = await createSemester("115-1");
  const r = await importRoster(semesterId, CSV_OK); // 第1組 2 人、第2組 1 人、1 位專案幹部
  expect(r).toEqual({ ok: true, imported: 4 });
  const svc = createServiceSupabase();
  const { data: groups } = await svc.from("groups").select("name, lines(kind)").eq("semester_id", semesterId).order("name");
  expect(groups).toEqual([{ name: "第1組", lines: [{ kind: "project" }] }, { name: "第2組", lines: [{ kind: "project" }] }]);
});
```

→ 紅 → 實作（先 `parseRosterCsv`，失敗直接回傳 errors；成功後用一個 Postgres 函式 `import_roster(semester_id, rows jsonb)` 在單一交易裡建組、線、成員，任何一步失敗全部回滾）→ 綠

- [ ] **Step 3: 失敗測試：CSV 有錯就一筆都不寫入**（錯誤訊息原樣回傳；資料庫 members 為 0）→ 紅 → 綠
- [ ] **Step 4: 失敗測試：已經匯入過的學期不能再整批匯入**（回傳 `{ ok:false, errors:["本學期已匯入名單；學期中的異動請用「換組」」"] }`）→ 紅 → 綠
- [ ] **Step 5: 失敗測試：`savePeriods` 依日期排序編成第 1、2、3 期，截止時間照台北時間存**；日期重複、格式錯回傳錯誤 → 紅 → 綠
- [ ] **Step 6: 失敗測試：`setPmGroups` 取代該專案幹部原本的負責組別**；對「其他幹部」呼叫要丟錯 → 紅 → 綠
- [ ] **Step 7: 失敗測試：`setRedAfterHours` 只收 1–720 的整數** → 紅 → 綠
- [ ] **Step 8: 失敗測試：`moveMember` 換組後，舊組的進度紀錄仍在舊組**（先以服務身分在第1組專案線插一筆進度，把人移到第2組，第1組的那筆還在、`submitted_by` 還是他）→ 紅 → 綠
- [ ] **Step 9: 元件測試 `periods-form.test.tsx`**：「按『新增一期』多一列；時間預設 23:59；送出時呼叫 `savePeriods` 並帶正確資料」→ 紅 → 綠
- [ ] **Step 10: 畫面**：`/admin` 用 shadcn `Card` 分五區（本學期、名單匯入＋錯誤清單、期別表、專案幹部負責組別勾選表、燈號門檻），`(app)/page.tsx` 管理員導到 `/admin`
- [ ] **Step 11: 失敗 E2E**：管理員登入 → 建立 `115-1` → 貼上 CSV → 看到「已匯入 4 人」→ 填兩期 → 看到期別表 → 勾選專案幹部負責第1組 → 重新整理後勾選仍在 → 紅 → 綠
- [ ] **Step 12: 全套＋截圖自評（兩輪）＋提交** `feat(admin): semester, roster import, periods, PM assignment, thresholds`

**你會看到什麼／怎麼驗收：** 用管理員帳號登入會直接到「學期設定」頁。拿一份故意寫錯的 CSV（例如角色打成「學生」）上傳，會看到「第 3 列：角色「學生」不是 專案幹部／其他幹部／專案生」，而且一個人都沒匯入；改好再傳，看到「已匯入 N 人」。填上線後各期截止日，會照日期排成第 1、2、3… 期。

---

## Task 6：第一次登入說明頁

**Files:**
- Create: `src/app/welcome/page.tsx`、`src/server/actions/acknowledge.ts`
- Modify: `src/app/(app)/layout.tsx`（沒按過「我已了解」就導到 `/welcome`）
- Test: `tests/integration/acknowledge.test.ts`、`tests/e2e/welcome.spec.ts`

**Interfaces:**
- Consumes: `requireOk`
- Produces: `acknowledge(): Promise<void>`（寫入 `acknowledgements(semester_id, email)`，重複按不會重複寫）、`hasAcknowledged(semesterId, email): Promise<boolean>`

- [ ] **Step 1: 失敗 E2E**：學生第一次登入 → 被帶到 `/welcome` → 看到規格 4.2 的五點說明 → 按「我已了解」→ 到自己組頁；再登入一次直接到組頁 → 紅
- [ ] **Step 2: 實作** layout 檢查＋頁面＋動作 → 綠
- [ ] **Step 3: 失敗 integration 測試**：「紀錄包含 email 與時間；同一學期按兩次只有一筆；新學期要重新按」→ 紅 → 綠
- [ ] **Step 4: 全套＋截圖自評＋提交** `feat: first-login notice with acknowledgement record`

說明頁內容照抄規格 4.2 的五點文字，不改寫。

**你會看到什麼／怎麼驗收：** 用學生測試帳號第一次登入，看到五點說明與「我已了解」按鈕，沒按之前打任何網址都會被帶回來；按了之後不再出現。Supabase 後台 `acknowledgements` 表看得到是誰、什麼時間按的。

---

## Task 7：PDF 上傳到 R2（契約邊界）

**需要 Task 0.4 的 R2 測試桶。**

**Files:**
- Create: `src/domain/pdf.ts`、`src/server/r2.ts`、`src/server/actions/upload.ts`
- Test: `src/domain/pdf.test.ts`、`tests/integration/r2.contract.test.ts`

**Interfaces:**
- Produces:

```ts
// src/domain/pdf.ts
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export function validatePdfMeta(f: { name: string; type: string; size: number }): { ok: true } | { ok: false; error: string };
export function isPdfMagic(head: Uint8Array): boolean; // 前 5 bytes 為 "%PDF-"
// src/server/r2.ts
export async function presignPdfPut(key: string, size: number): Promise<string>;  // 簽入 Content-Length 與 Content-Type，R2 會拒絕大小不符的上傳
export async function inspectUploaded(key: string): Promise<{ size: number; isPdf: boolean } | null>; // HEAD＋Range 0-4
export async function presignPdfGet(key: string, downloadName: string): Promise<string>; // 10 分鐘有效
export async function deleteObject(key: string): Promise<void>;
// src/server/actions/upload.ts
export async function requestPdfUpload(f: { name: string; type: string; size: number }): Promise<{ ok: true; key: string; url: string } | { ok: false; error: string }>;
```

`key` 格式：`{semesterName}/{groupId}/{uuid}.pdf`，由伺服器產生，不用使用者給的檔名。

- [ ] **Step 1–4: `validatePdfMeta` 紅綠**，一次一個 `it`：
  - 「20MB 整剛好可以」
  - 「20MB 多 1 byte 回傳『檔案超過 20MB』」
  - 「副檔名不是 .pdf 或 type 不是 application/pdf 回傳『只收 PDF』」
  - 「0 byte 回傳『檔案是空的』」
- [ ] **Step 5–6: `isPdfMagic` 紅綠**：「`%PDF-1.7` 開頭為 true；把 .docx 改名成 .pdf（`PK\x03\x04` 開頭）為 false」
- [ ] **Step 7: 失敗契約測試（打真實 R2 測試桶）** `tests/integration/r2.contract.test.ts`

```ts
import { describe, it, expect, afterAll } from "vitest";
import { presignPdfPut, inspectUploaded, deleteObject } from "@/server/r2";

const key = `contract-test/${crypto.randomUUID()}.pdf`;
const pdf = new TextEncoder().encode("%PDF-1.7\n%test\n");
afterAll(() => deleteObject(key));

describe.skipIf(!process.env.R2_BUCKET?.endsWith("-test"))("R2 契約", () => {
  it("用預簽網址 PUT 上傳，之後讀得到大小與 PDF 檔頭", async () => {
    const url = await presignPdfPut(key, pdf.byteLength);
    const res = await fetch(url, { method: "PUT", body: pdf, headers: { "Content-Type": "application/pdf" } });
    expect(res.status).toBe(200);
    expect(await inspectUploaded(key)).toEqual({ size: pdf.byteLength, isPdf: true });
  });
  it("實際內容比簽的大小大，R2 拒絕", async () => {
    const url = await presignPdfPut(`${key}.big`, 10);
    const res = await fetch(url, { method: "PUT", body: pdf, headers: { "Content-Type": "application/pdf" } });
    expect(res.ok).toBe(false);
  });
  it("不存在的檔案 inspectUploaded 回傳 null", async () => {
    expect(await inspectUploaded(`${key}.missing`)).toBeNull();
  });
});
```

`describe.skipIf` 只防止誤打正式桶；**Task 收尾時這組測試必須實際執行，不可以是 skipped**，HANDOFF 要記錄。

- [ ] **Step 8: 跑** `TZ=UTC npx vitest run --project integration tests/integration/r2.contract.test.ts` → FAIL
- [ ] **Step 9: 實作 `r2.ts`**

```ts
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { isPdfMagic } from "@/domain/pdf";

function client() {
  const r2 = env.r2;
  return { s3: new S3Client({ region: "auto", endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey } }), bucket: r2.bucket };
}
export async function presignPdfPut(key: string, size: number) {
  const { s3, bucket } = client();
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "application/pdf", ContentLength: size }), { expiresIn: 600, signableHeaders: new Set(["content-length", "content-type"]) });
}
export async function inspectUploaded(key: string) {
  const { s3, bucket } = client();
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const part = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: "bytes=0-4" }));
    const bytes = new Uint8Array(await part.Body!.transformToByteArray());
    return { size: head.ContentLength ?? 0, isPdf: isPdfMagic(bytes) };
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
    throw e;
  }
}
// presignPdfGet、deleteObject 同樣模式
```

- [ ] **Step 10: 跑** → PASS（三個都要實際執行並綠）
- [ ] **Step 11: `requestPdfUpload` integration 測試**（mock `r2.presignPdfPut`，只驗證「沒登入被拒」「不合規格的檔案直接回錯、不簽網址」）紅 → 綠
- [ ] **Step 12: 全套＋提交** `feat: direct-to-R2 PDF upload with signed size`

**你會看到什麼／怎麼驗收：** 沒有畫面（畫面在 Task 8）。R2 後台的 `ftl-casepool-test` 桶在測試過程會短暫出現 `contract-test/` 檔案，測試結束自動刪掉。執行者回報三個 R2 契約測試「實際執行且綠」，不是 skipped。

---

## Task 8：交雙週進度

**Files:**
- Create: `src/domain/progress.ts`、`src/server/actions/progress.ts`、`src/server/queries/my-group.ts`、`src/app/(app)/my-group/page.tsx`、`src/app/(app)/my-group/periods/[periodId]/page.tsx`、`src/app/(app)/my-group/periods/[periodId]/progress-form.tsx`
- Test: `src/domain/progress.test.ts`、`src/app/(app)/my-group/periods/[periodId]/progress-form.test.tsx`、`tests/integration/progress-actions.test.ts`、`tests/e2e/submit-progress.spec.ts`

**Interfaces:**
- Consumes: `validatePdfMeta`、`requestPdfUpload`、`inspectUploaded`（Task 7）、`requireOk`、`formatTaipei`、`daysUntil`
- Produces:

```ts
// src/domain/progress.ts
export type ProgressInput = { light: Light | null; did: string; blocked: string; nextSteps: string; hasPdf: boolean };
export function validateProgress(i: ProgressInput): { ok: true } | { ok: false; errors: Partial<Record<keyof ProgressInput, string>> };
export function lateBy(deadline: Date, submittedAt: Date): { late: false } | { late: true; hours: number };
// src/server/actions/progress.ts
export async function submitProgress(periodId: string, input: { light: Light; did: string; blocked: string; nextSteps: string; pdfKey: string }):
  Promise<{ ok: true } | { ok: false; error: string }>;
// src/server/queries/my-group.ts
export type PeriodRow = { periodId: string; seq: number; deadline: Date; report: null | { submittedAt: Date; submittedBy: string; light: Light; lockedAt: Date } };
export async function loadMyGroup(): Promise<{ groupName: string; projectName: string; lineId: string; periods: PeriodRow[] }>;
```

（`Light` 型別先在 `src/domain/lights.ts` 只宣告 `export type Light = "green" | "yellow" | "red";`，Task 11 再加函式。）

- [ ] **Step 1–6: `validateProgress` 紅綠**，一次一個：「沒選燈號」「三句話任一句空白（含只打空白）」「沒附 PDF」→ 各自有錯誤訊息；「都填齊 → ok」
- [ ] **Step 7–8: `lateBy` 紅綠**：「23:59 截止、23:59:40 交 → 不算逾期」（Review Focus 2）；「隔天 00:00:01 交 → 逾期，hours = 0」；「晚 50 小時 → hours = 50」
- [ ] **Step 9: 失敗 integration 測試：`submitProgress` 寫入一筆，繳交時間 = R2 上檔案確認後的時間，`submitted_by` 是送出者**（mock `inspectUploaded` 回傳 `{ size, isPdf: true }`）→ 紅 → 綠
- [ ] **Step 10: 失敗 integration 測試：R2 上沒有檔案、或檔頭不是 PDF → 回傳「檔案沒有上傳成功，請重新選擇 PDF」、不寫入** → 紅 → 綠
- [ ] **Step 11: 失敗 integration 測試：不是這組的人（或幹部）送出 → 被拒** → 紅 → 綠
- [ ] **Step 12: 失敗 integration 測試（Review Focus 4：同時送出）**

```ts
it("同一組兩人同時送出同一期，只留一份，另一人收到可理解的訊息", async () => {
  const [r1, r2] = await Promise.all([
    asUser("a1@g.nccu.edu.tw", () => submitProgress(seed.periodIds[0], input("k1"))),
    asUser("a2@g.nccu.edu.tw", () => submitProgress(seed.periodIds[0], input("k2"))),
  ]);
  expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
  expect([r1, r2].find((r) => !r.ok)).toEqual({ ok: false, error: "這一期剛剛已經有組員交了，請重新整理" });
});
```

→ 紅 → 實作（捕捉 Postgres `23505` unique violation 轉成這句話；輸的那一方把自己剛上傳的 R2 檔案刪掉）→ 綠

- [ ] **Step 13: 元件測試 `progress-form.test.tsx`**：「沒填齊時『送出』按鈕顯示各欄錯誤、不呼叫送出」「選了非 PDF 檔立刻顯示『只收 PDF』」「上傳中按鈕顯示『上傳中…』且不能重按」→ 每個紅 → 綠
- [ ] **Step 14: 畫面**
  - `/my-group`：組名與專案名、本條線的燈號（Task 11 前先顯示「—」）、期別清單（第 N 期、截止時間、剩幾天或「已逾期 X」、已交／未交、誰交的）、每期一個「交這期進度」按鈕
  - 交件頁：燈號三選一（綠／黃／紅，大按鈕，附文字）、三個輸入框（這兩週做了什麼／卡在哪裡／接下來要做什麼）、PDF 選擇（列出建議內容：本期成果截圖、會議紀錄、下期分工）、固定提示「⚠️ 替換檔案後，繳交時間以新檔案為準。」、送出
  - 流程：選檔 → `requestPdfUpload` → 瀏覽器 `PUT` 到 R2（顯示進度）→ `submitProgress` → 回組頁並出現「已送出，2 小時內可以修改」
  - 截止後仍可補交；頁面顯示「本期已逾期 X，仍可補交」
- [ ] **Step 15: 失敗 E2E**：學生登入 → 組頁 → 交第 1 期（上傳 `tests/fixtures/sample.pdf`）→ 回組頁看到第 1 期「已交 · 王小明 · 10/16（五）21:03」→ 紅 → 綠。E2E 用 R2 測試桶。
- [ ] **Step 16: 全套＋截圖自評兩輪（組頁、交件頁，含錯誤狀態、上傳中狀態）＋提交** `feat: biweekly progress submission`

**你會看到什麼／怎麼驗收：** 用學生帳號（手機寬度也要試）打開組頁，看到各期截止日和剩幾天；點進一期，少填一句會被擋並標出哪一格；傳一個改副檔名的 Word 檔會被擋；正常交出後回到組頁，看到誰、何時交的。

---

## Task 9：2 小時內修改、換 PDF、撤回；之後鎖定

**Files:**
- Create: `src/domain/lock.ts`、`supabase/migrations/20260927000002_lock.sql`
- Modify: `src/server/actions/progress.ts`、交件頁（已交時顯示修改模式）
- Test: `src/domain/lock.test.ts`、`tests/integration/progress-lock.test.ts`、`tests/e2e/edit-progress.spec.ts`

**Interfaces:**
- Produces:

```ts
// src/domain/lock.ts
export const LOCK_MS = 2 * 60 * 60 * 1000;
export function lockedAt(pdfUploadedAt: Date): Date;
export function isLocked(pdfUploadedAt: Date, now: Date): boolean;
// src/server/actions/progress.ts
export async function editProgress(reportId: string, input: { light: Light; did: string; blocked: string; nextSteps: string }): Promise<{ ok: true } | { ok: false; error: string }>; // 不改繳交時間
export async function replaceProgressPdf(reportId: string, pdfKey: string): Promise<{ ok: true; becameLate: boolean } | { ok: false; error: string }>; // 繳交時間改成新檔時間
export async function withdrawProgress(reportId: string): Promise<{ ok: true } | { ok: false; error: string }>; // 整筆刪除，R2 檔也刪，不留紀錄
```

鎖定規則：以**最後一份 PDF 的上傳時間**起算 2 小時。資料庫也要擋（第二道防線），migration 內容：

```sql
create function reject_if_locked() returns trigger language plpgsql as $$
begin
  if now() >= old.pdf_uploaded_at + interval '2 hours' then
    raise exception 'LOCKED' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger progress_lock before update or delete on progress_reports
  for each row execute function reject_if_locked();
```

- [ ] **Step 1–4: `isLocked` 紅綠**：「上傳後 1 小時 59 分 59 秒 → 未鎖」「剛好 2 小時 → 已鎖」
- [ ] **Step 5: 失敗 integration 測試：2 小時內 `editProgress` 改燈號與三句話成功，`pdf_uploaded_at` 不變** → 紅 → 綠
- [ ] **Step 6: 失敗 integration 測試：超過 2 小時 `editProgress`／`withdrawProgress` 回傳「已超過 2 小時，已鎖定不能修改」**（測試用服務身分把 `pdf_uploaded_at` 改成 3 小時前；因 trigger 也會擋這個 update，測試 helper 用 `set session_replication_role = replica` 暫停 trigger 來造資料）→ 紅 → 綠
- [ ] **Step 7: 失敗 integration 測試：直接對資料庫 update 已鎖定的列 → 被 trigger 拒絕**（真實邊界：證明就算伺服器程式有 bug，資料庫也擋）→ 紅 → 綠
- [ ] **Step 8: 失敗 integration 測試：`replaceProgressPdf` 把繳交時間改成新檔時間、舊 R2 檔刪除** → 紅 → 綠
- [ ] **Step 9: 失敗 integration 測試（Review Focus 3）**

```ts
it("截止前交、過了截止才換 PDF → 變成逾期，並回傳 becameLate", async () => {
  // 期別截止 = 現在 - 30 分鐘；原本 PDF 在截止前 10 分鐘上傳（仍在 2 小時內）
  const r = await asUser("a1@g.nccu.edu.tw", () => replaceProgressPdf(reportId, "new-key"));
  expect(r).toEqual({ ok: true, becameLate: true });
});
```

→ 紅 → 綠。畫面在按「換檔」前，若現在已過截止且原本準時，先跳確認框：「現在換檔，這期會變成逾期繳交。確定要換嗎？」

- [ ] **Step 10: 失敗 integration 測試：`withdrawProgress` 後資料庫沒有該筆、R2 沒有檔案、該期回到未交** → 紅 → 綠
- [ ] **Step 11: 失敗 E2E**：交件後頁面顯示「可修改到 10/16（五）23:03」→ 改一句話 → 儲存 → 看到新內容且繳交時間不變 → 撤回 → 該期回到「未交」→ 紅 → 綠
- [ ] **Step 12: 全套＋截圖自評＋提交** `feat: 2-hour edit window and lock`

**你會看到什麼／怎麼驗收：** 交完後 2 小時內，組頁那一期旁邊有「修改」「換 PDF」「撤回」三個按鈕，並寫著「可修改到幾點」。過了那個時間按鈕消失，改成「已鎖定」。在截止後才換 PDF，會先跳出警告。

---

## Task 10：中間週點燈號

**Files:**
- Modify: `src/domain/progress.ts`、`src/app/(app)/my-group/page.tsx`
- Create: `src/server/actions/checkin.ts`、`src/app/(app)/my-group/checkin-dialog.tsx`
- Test: `src/domain/progress.test.ts`、`src/app/(app)/my-group/checkin-dialog.test.tsx`、`tests/integration/checkin.test.ts`

**Interfaces:**
- Produces: `validateCheckin(i: { light: Light | null; note: string }): { ok: true } | { ok: false; error: string }`；`submitCheckin(input: { light: Light; note?: string }): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1–4: `validateCheckin` 紅綠**：「紅燈沒寫卡在哪裡 → 『紅燈請補一句卡在哪裡』」「黃燈、綠燈不用寫」「沒選燈號 → 錯」
- [ ] **Step 5: 失敗 integration 測試：寫入 `checkins`，記錄誰、何時；非本組成員被拒；紅燈沒說明被資料庫 check 擋下** → 紅 → 綠
- [ ] **Step 6: 元件測試**：「選紅燈時才出現『卡在哪裡』輸入框」→ 紅 → 綠
- [ ] **Step 7: 畫面**：組頁「點一下這週燈號」按鈕 → shadcn `Dialog` → 送出後組頁的「最近回報」更新為「黃燈 · 王小明 · 10/09（五）14:20」
- [ ] **Step 8: 全套＋截圖自評＋提交** `feat: mid-week light check-in`

**你會看到什麼／怎麼驗收：** 組頁有「點一下這週燈號」，按了跳出三個燈；選紅燈才會多一格要你寫卡在哪裡，沒寫送不出去。送出後看到誰、何時點的。

---

## Task 11：燈號規則與準時率

**Files:**
- Modify: `src/domain/lights.ts`
- Create: `src/domain/on-time.ts`、`src/components/light-badge.tsx`
- Test: `src/domain/lights.test.ts`、`src/domain/on-time.test.ts`、`src/components/light-badge.test.tsx`

**Interfaces:**
- Produces:

```ts
// src/domain/lights.ts
export type Deliverable = { label: string; deadline: Date; submittedAt: Date | null; returned?: boolean };
export type SystemLight = { light: Light; reason: string | null };
export function overdueLabel(hours: number): string;        // < 24 → "逾期 N 小時"；否則 "逾期 N 天"（無條件捨去）
export function systemLight(ds: Deliverable[], now: Date, s: { redAfterHours: number }): SystemLight;
export function reporterLight(events: { light: Light; at: Date }[]): Light | null; // 最新一筆
export function displayLight(reporter: Light | null, system: SystemLight): { light: Light; source: string };
// src/domain/on-time.ts
export function onTimeRate(ds: Deliverable[], now: Date): number | null; // 沒有已到期項目 → null
```

一次一個 `it`，全部走紅 → 綠：

- [ ] **`systemLight`**
  1. 「沒有到期項目 → 綠，reason null」
  2. 「過截止 1 小時未交 → 黃，『系統：第 2 期逾期 1 小時』」
  3. 「過截止 71 小時 59 分 → 黃」
  4. 「過截止剛好 72 小時 → 紅，『系統：第 2 期逾期 3 天』」
  5. 「門檻改成 48 → 過 48 小時就紅」
  6. 「逾期但已補交 → 綠（補交立即重新判定）」
  7. 「兩期都欠，取最嚴重那期當 reason」
  8. 「`returned: true` → 黃，『系統：第 2 期被退回』」（批次 3 才會用到，先鎖死規則）
  9. 「還沒到截止、未交 → 綠」
- [ ] **`reporterLight`**：「沒有回報 → null」「取時間最新的一筆，不管是雙週進度還是中間週」
- [ ] **`displayLight`**
  1. 「回報紅、系統綠 → 紅，來源『組員回報』」
  2. 「回報綠、系統紅 → 紅，來源『系統：第 2 期逾期 3 天』」
  3. 「一樣嚴重（都黃）→ 來源『組員回報＋系統：第 2 期逾期 1 天』」
  4. 「沒有回報、系統綠 → 綠，來源『系統：沒有欠交』」
  5. 「都綠 → 綠，來源『組員回報』」
- [ ] **`onTimeRate`**
  1. 「沒有已到期項目 → null（畫面顯示『—』）」
  2. 「3 期到期、2 期準時 → 2/3」
  3. 「晚交的算不準時；到期沒交的也算不準時」
  4. 「23:59 截止、23:59:40 交 → 準時」（Review Focus 2）
  5. 「還沒到期的項目不算進分母」
- [ ] **`LightBadge` 元件測試**：「顯示顏色圓點＋文字『紅燈』＋來源；有 `aria-label`『紅燈，系統：第 2 期逾期 3 天』」
- [ ] **接到組頁**：`/my-group` 顯示本條線的顯示燈與準時率
- [ ] **全套＋截圖自評＋提交** `feat(domain): light rules and on-time rate`

**你會看到什麼／怎麼驗收：** 組頁上方出現這條線的燈號、來源和準時率。執行者回報測試清單，你可以對照規格 4.5 的表一條條看：72 小時邊界、補交後變綠、較嚴重者優先、來源文字。

---

## Task 12：幹部總覽看板

**Files:**
- Create: `src/domain/dashboard.ts`、`src/server/queries/dashboard.ts`、`src/app/(app)/dashboard/page.tsx`、`src/components/group-card.tsx`
- Modify: `src/app/(app)/page.tsx`（幹部導到 `/dashboard`，學生導到 `/my-group`）
- Test: `src/domain/dashboard.test.ts`、`tests/integration/dashboard-query.test.ts`、`tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: `systemLight`、`reporterLight`、`displayLight`、`onTimeRate`、`daysUntil`、`formatTaipei`、`line_light_events`（Task 4）
- Produces:

```ts
export type GroupCard = {
  groupId: string; groupName: string; projectName: string;
  lines: { lineId: string; kind: "project"; light: Light; source: string; onTime: number | null }[];
  stage: string;                       // 第一版：「第 N 期」＝下一個還沒到的期別
  nextDeadline: { at: Date; daysLeft: number } | null;
};
export function worstLight(card: GroupCard): Light;
export function sortGroupCards(cards: GroupCard[]): GroupCard[]; // 紅 → 黃 → 綠，同色依組名
export function buildGroupCard(input: { group: { id: string; name: string; projectName: string }; lineId: string;
  periods: { seq: number; deadline: Date }[]; submissions: { periodSeq: number; submittedAt: Date }[];
  events: { light: Light; at: Date }[]; now: Date; redAfterHours: number }): GroupCard;
```

- [ ] **Step 1–6: `dashboard.ts` 紅綠**，一次一個：
  - 「`sortGroupCards`：紅燈組排最前，其次黃，再來綠；同色依組名」
  - 「`buildGroupCard`：下一個截止日是最近一個還沒過的期別，剩幾天用台北日曆」
  - 「全部期別都過了 → `nextDeadline` null、stage『本學期期別已結束』」
  - 「燈號與準時率正確帶入（用 Task 11 的函式，不重算）」
- [ ] **Step 7: 失敗 integration 測試（真實邊界）**：「其他幹部帳號呼叫 `loadDashboard()` 拿得到所有組的燈號與準時率；回傳資料裡**沒有**三句話、PDF key、紅燈說明欄位」→ 紅 → 綠。`loadDashboard` 只能用使用者身分連線讀 `groups`、`lines`、`periods`、`line_light_events`。
- [ ] **Step 8: 失敗 E2E**：種子資料讓第2組逾期 4 天 → 其他幹部登入 → 看板第一張卡是第2組、紅燈、「系統：第 1 期逾期 4 天」→ 學生打 `/dashboard` 被導回 `/my-group` → 紅 → 綠
- [ ] **Step 9: 畫面**：每組一張 `GroupCard`（組名＋專案名、每條線的 `LightBadge`、目前階段、下一個截止日「10/16（五）23:59 · 剩 5 天」、準時率「67%」）；桌機三欄、手機一欄；空狀態「還沒有組別，請管理員匯入名單」；專案幹部看到自己負責的組卡片上有「你負責」標記。
- [ ] **Step 10: 全套＋截圖自評兩輪＋提交** `feat: officer dashboard`

**你會看到什麼／怎麼驗收：** 用幹部帳號登入，直接看到每組一張卡，紅燈的組在最上面，卡片上寫著為什麼紅（例如「系統：第 1 期逾期 4 天」）、下一個截止還剩幾天、準時率。用「其他幹部」帳號點不到任何三句話或 PDF。

---

## Task 13：部署、正式設定與一組試用

**需要 Task 0.2–0.6 全部完成。**

**Files:**
- Create: `docs/runbook.md`（白話交接手冊：環境變數清單、如何新增學期、如何換組、Supabase 喚醒設定、備份方式）
- Modify: `HANDOFF.md`

- [ ] **Step 1**：`npx supabase link` 到正式專案，`npx supabase db push` 套用 migrations
- [ ] **Step 2**：Supabase 後台開 Google 登入，填 Task 0.3 的 OAuth 用戶端
- [ ] **Step 3**：Vercel 設定環境變數（`ENABLE_TEST_LOGIN` **不設**），部署
- [ ] **Step 4**：驗證 `https://<網址>/test-login` 回 404
- [ ] **Step 5**：設定免費定時喚醒（例如 GitHub Actions 每 3 天打一次首頁），寫進 runbook
- [ ] **Step 6**：確認 Supabase 免費方案備份方式，寫進 runbook（規格第 6 節注意事項）
- [ ] **Step 7**：部署版本實測核心流程：管理員建學期、匯入名單、填期別 → 學生登入、按「我已了解」、交一期、2 小時內修改 → 幹部看板看到燈號（照測試政策「部署後驗證實際部署版本」）
- [ ] **Step 8**：部署網址截圖自評（看板、組頁、交件頁；桌機＋手機）
- [ ] **Step 9**：請 1 組試用一輪，問題記進 `HANDOFF.md`
- [ ] **Step 10**：合併 `feat/batch1` 到 `main`（開 PR），合併後在 `main` 重跑全套

**你會看到什麼／怎麼驗收：** 一個正式網址。你用自己的學校帳號登入能走完：建學期 → 匯入名單 → 填期別；請一位組員用手機交一期；幹部帳號在看板看到那一組變成已交、燈號正確。

---

## Task 14：看已交內容（2026-09-27 產品負責人決定放進第一版）

依規格第 3 節「看進度內容（三句話、PDF、里程碑檔案、評語）：管理員 ✓、專案幹部 ✓、其他幹部 ✗、專案生只看自己組」。批次 1 的內容 = 雙週進度的燈號、三句話、PDF，以及中間週燈號的紅燈說明。

**Files:**
- Create: `src/server/queries/group-detail.ts`、`src/server/actions/download.ts`、`src/app/(app)/groups/[groupId]/page.tsx`（＋ `loading.tsx`）、`src/components/pdf-download-button.tsx`
- Modify: `src/components/group-card.tsx`（專案幹部、管理員看到「看內容」連結；其他幹部沒有）、`src/app/(app)/my-group/periods/[periodId]/editable-report.tsx`（加「下載 PDF」）、`src/app/(app)/my-group/page.tsx`（中間週燈號歷程）
- Test: `tests/integration/group-detail.test.ts`、`tests/integration/download.test.ts`、`tests/e2e/group-detail.spec.ts`、元件測試

**Interfaces:**
- `loadGroupDetail(groupId): Promise<{ group, display, onTime, periods: { seq, deadline, report: null | { light, did, blocked, nextSteps, submittedBy(姓名), submittedAt, timing, reportId } }[], checkins: { light, note, by(姓名), at }[] } | null>`：專案幹部走使用者身分連線（RLS 決定）；沒有 member 列的管理員走服務身分並只選同樣欄位；其他幹部、別組學生 → `null`（頁面顯示 404）。
- `getPdfDownloadUrl(reportId): Promise<{ ok: true; url: string } | { ok: false; error: "找不到這份進度" }>`：先用使用者身分連線讀該筆（RLS 擋掉其他幹部與別組），管理員走服務身分；通過才呼叫 `presignPdfGet(key, 下載檔名)`，下載檔名 `{學期}-{組名}-第{N}期.pdf`（`Content-Disposition: attachment` 並用 RFC 5987 `filename*` 處理中文）。

**行為（每個一個紅→綠循環）：**
1. 專案幹部讀得到任一組的三句話與紅燈說明；其他幹部 `loadGroupDetail` 回 `null`；學生讀自己組可以、別組 `null`；管理員（不在名單）讀得到。
2. `getPdfDownloadUrl`：學生自己組 ok、別組／其他幹部／亂填 id 一律 `找不到這份進度`、專案幹部與管理員 ok；網址是預簽的 GET、10 分鐘有效。
3. 看板：專案幹部與管理員的組卡片有「看內容」連到 `/groups/[id]`，其他幹部沒有；其他幹部直接打網址看到 404。
4. 組內容頁：每期一列（未交、準時、逾期 N 天），展開看燈號、三句話、誰交、何時、下載 PDF；下方列出中間週燈號歷程（燈號、誰、何時、紅燈說明）。
5. 學生組頁：已交的期別可下載自己的 PDF；中間週燈號歷程同上。
6. E2E：專案幹部從看板點進第1組、看到三句話、按下載拿到 PDF（檢查回應的 content-type 與檔頭 `%PDF-`）；其他幹部看不到連結、打網址 404。

**你會看到什麼／怎麼驗收：** 用專案幹部帳號登入，看板每張卡多一個「看內容」，點進去看得到每一期三句話、誰交、何時、準時或逾期，按「下載 PDF」會下載檔案；用其他幹部帳號就沒有這個連結。學生在自己組頁也能下載自己交的 PDF。

---

## 之後的批次（各自另寫計畫，開工前再拆）

| 批次 | 內容 | 依賴第一版的哪些東西 | 開工前要先問你的事 |
| --- | --- | --- | --- |
| 1.5（若 10/02 前沒做完的收尾） | 換組畫面、看板篩選 | Task 5、12 | — |
| 2（約 10/09） | 競賽大廳（手動填）、掛比賽、勾參賽成員、確認報名、比賽線與三階段截止日 | `lines`（`kind='competition'`）、`systemLight` 已支援多條線 | 比賽結果（晉級／得獎／未入選）誰能改、改錯怎麼辦 |
| 3（M2 截止前） | 里程碑 M1–M3、比賽階段審核、退回重交版本、「待你審核」清單、email 通知、定時工作（每 15 分鐘） | Task 7 上傳、Task 9 鎖定、`returned` 燈號規則已寫好 | M1 補登怎麼做；Gmail 寄信方式；里程碑那期是否免交雙週進度 |
| 4（批次 3 後一週） | AI 貼網址整理競賽 | 批次 2 的競賽表單 | Claude API 綁卡 |
| 5（期末前） | 期末匯出壓縮檔、設為唯讀、刪除學期 | 全部資料表 | — |

## Self-Review 紀錄

- **規格覆蓋（批次 1）**：4.1 登入與名單 → Task 4、5；4.2 說明頁 → Task 6；4.3 上傳規則 → Task 7、9；4.4 雙週與中間週 → Task 8、10；4.5 燈號與準時率 → Task 11；4.6 幹部看板 → Task 12（「待你審核」屬批次 3）；第 3 節權限 → Task 4 RLS 測試、Task 12 integration；第 6 節喚醒與備份 → Task 13；第 12 節十一項決定 → 全部反映在 Global Constraints 與各 Task。
- **不在批次 1**：4.7–4.11，見「之後的批次」。
- **型別一致**：`Light`、`Deliverable`、`Member`、`Access`、`GroupCard` 各只定義一次，後續 Task 以 Consumes 引用。
- **Review Focus**：五條各自有測試落在 Task 2、3、8、9、11。
