import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 6 整合檢查（Task 1 補）：競賽大廳卡片上的「報名截止」文字要用 --danger 色（規格 §14）。
// 跟 adj-t3/t4/t5-screenshots.spec.ts 同一套規矩：預設跳過，明確帶 CAPTURE_SCREENSHOTS=1
// 才會真的執行、把截圖存成檔案。
//
//   CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1 npx playwright test tests/e2e/adj-t1-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`adj-t1 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester({ acknowledged: true });
    const db = service();
    await db.from("acknowledgements").insert({ semester_id: seed.semesterId, email: "admin@g.nccu.edu.tw" });
    await db.from("competitions").insert([
      {
        semester_id: seed.semesterId,
        name: "全國大學生黑客松",
        organizer: "教育部",
        theme: "永續發展",
        eligibility: "大專院校在學學生",
        team_size: "3-5 人",
        prize: "冠軍 10 萬元",
        url: "https://example.com/hackathon",
        signup_deadline: "2099-12-01T15:59:59.999Z",
        submission_deadline: "2099-12-20T15:59:59.999Z",
        final_date: "2099-12-25T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      },
      {
        semester_id: seed.semesterId,
        name: "已截止的比賽",
        url: "https://example.com/closed",
        signup_deadline: "2020-01-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      },
    ]);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`/competitions（報名截止用 --danger 紅字，開放與已截止都適用）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto("/competitions");
      const openDeadline = page.locator("p", { hasText: "報名截止：" }).first();
      await expect(openDeadline).toBeVisible();
      await expect(openDeadline).toHaveCSS("color", "rgb(179, 38, 30)");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t1-lobby-${size.name}.png`, fullPage: true });
    });
  }
});
