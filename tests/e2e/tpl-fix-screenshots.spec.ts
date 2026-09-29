import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// 最終審查修正的視覺自我檢查：還沒匯入名單時的「成員」區塊（沒有新增成員按鈕、改顯示先匯入的
// 提示）、名單匯入卡片，以及建立學期名稱含「/」時表單上的錯誤訊息。
// 預設跳過；CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1|2 npx playwright test tests/e2e/tpl-fix-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`tpl-fix 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    const db = service();
    await db.from("pm_assignments").delete().not("group_id", "is", null);
    await db.from("members").delete().eq("semester_id", seed.semesterId);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`還沒匯入名單 ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
      const prefix = `.screenshots/round${ROUND}-tpl-fix-${size.name}`;

      const members = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
      await members.scrollIntoViewIfNeeded();
      await expect(members.getByRole("button", { name: "新增成員" })).toHaveCount(0);
      await members.screenshot({ path: `${prefix}-members-empty.png` });

      const roster = page.locator('[data-slot="card"]').filter({ has: page.getByText("名單匯入", { exact: true }) });
      await roster.screenshot({ path: `${prefix}-roster.png` });

      await page.getByRole("button", { name: "開始新學期…" }).click();
      await page.getByLabel("學期名稱").fill("115/2");
      await page.getByRole("button", { name: "建立學期" }).click();
      await page.getByLabel("再輸入一次新學期名稱").fill("115/2");
      await page.getByRole("button", { name: "確定建立" }).click();
      const form = page.getByRole("form", { name: "建立學期" });
      await expect(form.getByRole("alert")).toHaveText("學期名稱不能有「/」");
      await page.mouse.move(0, 0);
      await form.screenshot({ path: `${prefix}-semester-error.png` });

      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      fs.writeFileSync(`${prefix}-scrollwidth.txt`, String(scrollW));
    });
  }
});
