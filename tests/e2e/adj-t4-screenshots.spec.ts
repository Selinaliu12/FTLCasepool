import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";

// Task 4 視覺自我檢查用的截圖腳本：看板卡片（組員＋備註）、/my-group（組員＋備註編輯欄，含
// 錯誤狀態）、/groups/[id]（組員含學號＋備註）。跟 adj-t2/adj-t3 同一套規矩：預設跳過，
// 明確帶 CAPTURE_SCREENSHOTS=1 才會真的執行、把截圖存成檔案。
//
//   CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1 npx playwright test tests/e2e/adj-t4-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

let groupAId: string;

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

test.describe.serial(`adj-t4 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    groupAId = seed.groupA;
    const svc = service();
    await svc
      .from("members")
      .update({ student_id: "110701001", dept_year: "資科三" })
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw");
    await svc
      .from("groups")
      .update({ note: "智慧記帳系統", note_updated_by: "甲一", note_updated_at: new Date().toISOString() })
      .eq("id", seed.groupA);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`看板卡片（組員＋備註）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
      await expect(page.getByText("智慧記帳系統")).toBeVisible();
      await expect(page.getByText("甲一 · 資科三")).toBeVisible();
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t4-dashboard-card-${size.name}.png`, fullPage: true });
    });

    test(`/my-group（組員＋備註編輯欄，含錯誤狀態）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await expect(page.getByText("甲一 · 資科三")).toBeVisible();
      await expect(page.getByLabel("組別備註")).toHaveValue("智慧記帳系統");
      // 觸發錯誤狀態：超過 200 字。
      await page.getByLabel("組別備註").fill("字".repeat(201));
      await page.getByRole("button", { name: "儲存" }).click();
      await expect(page.getByText("備註最多 200 字")).toBeVisible();
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t4-my-group-note-error-${size.name}.png`, fullPage: true });
    });

    test(`/groups/[id]（組員含學號＋備註）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto(`/groups/${groupAId}`);
      await expect(page.getByText("甲一 · 110701001 · 資科三")).toBeVisible();
      await expect(page.getByText("智慧記帳系統")).toBeVisible();
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t4-group-detail-${size.name}.png`, fullPage: true });
    });
  }
});
