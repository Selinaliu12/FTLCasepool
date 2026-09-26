import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, ensureLocalStorageBucket, uploadTestPdf } from "../integration/helpers";

// Task 14 視覺自我檢查用的截圖腳本（Fix round 1，controller 要求）：Browser 工具沒有把螢幕
// 截圖存成檔案的能力，Playwright 有，所以改用一支「預設跳過」的 e2e spec 產生
// .screenshots/content-*.png，讓截土真的落地成檔案可以回顧，而不是只在對話裡看一次。
//
// 執行方式（不會在一般的 `npx playwright test` 裡自動跑，需要明確帶環境變數）：
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/manual-screenshots.spec.ts
//
// 這支測試會自己 resetDb／seedSemester，結束後照樣還原種子資料（跟 dashboard.spec.ts／
// group-detail.spec.ts 同一套規矩），所以帶著這個環境變數跑不會弄髒其他測試依賴的資料。
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

test.describe.serial("Task 14 視覺自我檢查截圖（手動執行，預設跳過）", () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  let groupAId: string;

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    groupAId = seed.groupA;
    await ensureLocalStorageBucket();
    // 讓「已交」的期別看起來完整：seedSemester() 的種子報告只有 DB 列，Storage 裡沒有真的
    // 檔案（跟 group-detail.spec.ts 需要的前提一樣）。
    const pdf = new TextEncoder().encode("%PDF-1.7\n%screenshot-fixture\n");
    await uploadTestPdf("reports/lineA/period1.pdf", pdf);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`看板（專案幹部，有「看內容」連結）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await expect(page.getByRole("link", { name: "看內容" }).first()).toBeVisible();
      await page.screenshot({ path: `.screenshots/content-dashboard-pm-${size.name}.png`, fullPage: true });
    });

    test(`看板（其他幹部，沒有「看內容」連結）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
      await expect(page.getByRole("link", { name: "看內容" })).toHaveCount(0);
      await page.screenshot({ path: `.screenshots/content-dashboard-officer-${size.name}.png`, fullPage: true });
    });

    test(`/groups/[id]（收合狀態）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto(`/groups/${groupAId}`);
      await expect(page.getByRole("heading", { name: "第1組" })).toBeVisible();
      await page.screenshot({ path: `.screenshots/content-group-detail-collapsed-${size.name}.png`, fullPage: true });
    });

    test(`/groups/[id]（展開第1期）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto(`/groups/${groupAId}`);
      await page.getByText(/已交 · 甲一 · /).first().click();
      await expect(page.getByText("完成初版原型")).toBeVisible();
      await page.screenshot({ path: `.screenshots/content-group-detail-expanded-${size.name}.png`, fullPage: true });
    });

    test(`/my-group（中間週燈號歷程）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await expect(page.getByRole("heading", { name: "中間週燈號歷程" })).toBeVisible();
      await page.screenshot({ path: `.screenshots/content-my-group-checkins-${size.name}.png`, fullPage: true });
    });

    test(`單期報告頁（下載 PDF 按鈕）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.getByRole("link", { name: "查看這期" }).first().click();
      await expect(page.getByRole("button", { name: "下載 PDF" })).toBeVisible();
      await page.screenshot({ path: `.screenshots/content-period-download-${size.name}.png`, fullPage: true });
    });
  }
});
