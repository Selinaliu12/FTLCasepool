import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";

// Adjustments Task 3 視覺自我檢查用的截圖腳本：頁首「身份：{label} ▾」切換（關閉／打開）。
// 跟 adj-t2-screenshots.spec.ts 同一套規矩：預設跳過，明確帶 CAPTURE_SCREENSHOTS=1 才會執行。
//
//   CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1 npx playwright test tests/e2e/adj-t3-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

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

test.describe.serial(`adj-t3 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    const db = service();
    const { data: g } = await db.from("groups").insert({ semester_id: seed.semesterId, name: "第10組", project_name: "專案十" }).select().single();
    await db.from("lines").insert({ group_id: g!.id, kind: "project" });
    // 一個名字比較長的人，同時是其他幹部＋第1組＋第10組專案生（三個身份，檢查窄螢幕的截斷）。
    await db.from("members").insert([
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "歐陽多組同學", role: "officer", group_id: null },
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "歐陽多組同學", role: "student", group_id: seed.groupA },
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "歐陽多組同學", role: "student", group_id: g!.id },
    ]);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`身份切換（關閉／打開）@ ${size.name}`, async ({ page, context }) => {
      await context.clearCookies();
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "multi@g.nccu.edu.tw", /\/dashboard$/);
      // 先切到第10組專案生，讓按鈕上的標籤是最長的那個。
      await page.getByRole("button", { name: "身份：其他幹部 ▾" }).click();
      await page.getByRole("menuitemradio", { name: "第10組專案生" }).click();
      await expect(page).toHaveURL(/\/my-group$/);
      const trigger = page.getByRole("button", { name: "身份：第10組專案生 ▾" });
      await expect(trigger).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "第10組" })).toBeVisible();
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t3-switcher-closed-${size.name}.png` });
      await trigger.click();
      await expect(page.getByRole("menuitemradio", { name: "第1組專案生" })).toBeVisible();
      // 等打開的淡入／縮放動畫跑完再截圖（不然會截到半透明的選單）。
      await page.getByRole("menu").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      await page.screenshot({ path: `.screenshots/round${ROUND}-adj-t3-switcher-open-${size.name}.png` });
    });
  }
});
