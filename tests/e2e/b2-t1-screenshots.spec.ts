import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

// src/server/supabase.ts 的 createServiceSupabase() 開頭是 `import "server-only"`，在
// Playwright 的一般 node 行程（不是 Next 的 bundler）直接 import 會無條件丟例外，跟
// helpers.ts 內部的 service() 一樣直接用 @supabase/supabase-js 建一個 service-role client。
function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// 一次性截圖腳本（batch 2 Task 1：每期建議繳交內容），controller 要求兩輪 1280x800 +
// 375x812 螢幕截圖自我檢查。跟 manual-screenshots.spec.ts 同一套規矩：自己
// resetDb／seedSemester，結束後照樣還原種子資料，不弄髒其他測試依賴的資料。
//
// 跟 manual-screenshots.spec.ts 一樣預設跳過：這支會 resetDb／seedSemester，如果在一般的
// `npx playwright test` 裡自動跑，會把其他測試依賴的種子資料洗掉、拖慢整個套件。執行方式
// （不會在一般的 `npx playwright test` 裡自動跑，需要明確帶環境變數）：
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/b2-t1-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

async function loginAndPassWelcome(page: Page, email: string, waitForUrl: RegExp) {
  await page.goto(`/test-login?email=${email}`);
  await Promise.race([
    page.waitForURL(waitForUrl),
    page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
  ]);
  if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "我已了解" }).click();
  }
  await expect(page).toHaveURL(waitForUrl);
}

test.describe.serial("b2-t1 視覺自我檢查截圖", () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  let periodId1: string;

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester({ acknowledged: true });
    periodId1 = seed.periodIds[0];

    const svc = serviceSupabase();
    await svc.from("periods").update({ suggestion: "1. 成果截圖\n2. 會議紀錄" }).eq("id", seed.periodIds[0]);
    await svc.from("periods").update({ suggestion: "第 2 期建議：下期分工表" }).eq("id", seed.periodIds[1]);
    // seedSemester({acknowledged:true}) 只幫種子名單裡的人插 acknowledgements，管理員的
    // email 來自 ADMIN_EMAILS（不在名單 CSV 裡），要另外補一筆，不然管理員登入也會被
    // (app)/layout.tsx 導去 /welcome。
    await svc.from("acknowledgements").insert({ semester_id: seed.semesterId, email: "admin@g.nccu.edu.tw" });
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`管理員期別表（含已凍結、含建議內容）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
      await expect(page.getByText("已有人交件", { exact: true })).toBeVisible();
      await page.screenshot({ path: `.screenshots/b2-t1-admin-periods-${size.name}.png`, fullPage: true });
    });

    test(`學生交件頁（顯示本期建議繳交）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "b1@g.nccu.edu.tw", /\/my-group$/);
      await expect(page.getByText(/本期建議繳交/).first()).toBeVisible();
      await page.screenshot({ path: `.screenshots/b2-t1-my-group-${size.name}.png`, fullPage: true });

      await page.goto(`/my-group/periods/${periodId1}`);
      await expect(page.getByText(/本期建議繳交/)).toBeVisible();
      await page.screenshot({ path: `.screenshots/b2-t1-period-page-${size.name}.png`, fullPage: true });
    });
  }
});
