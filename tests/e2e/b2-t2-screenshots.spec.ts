import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// b2-t2（競賽卡片與競賽大廳）視覺自我檢查截圖，跟 b2-t1-screenshots.spec.ts 同一套規矩：
// 預設跳過、自己控制種子資料、結束後還原。執行方式：
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/b2-t2-screenshots.spec.ts
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

test.describe.serial("b2-t2 視覺自我檢查截圖", () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester({ acknowledged: true });
    await serviceSupabase().from("acknowledgements").insert({ semester_id: seed.semesterId, email: "admin@g.nccu.edu.tw" });

    const svc = serviceSupabase();
    const { error } = await svc.from("competitions").insert([
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
      {
        semester_id: seed.semesterId,
        name: "還沒發布的草稿",
        url: "https://example.com/draft",
        signup_deadline: "2099-12-01T15:59:59.999Z",
        status: "draft",
        created_by: "pm@g.nccu.edu.tw",
      },
    ]);
    if (error) throw error;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`/competitions（幹部：開放＋已截止＋草稿）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto("/competitions");
      await expect(page.getByText("全國大學生黑客松")).toBeVisible();
      await expect(page.getByText("已截止的比賽")).toBeVisible();
      await expect(page.getByText("還沒發布的草稿")).toBeVisible();
      await page.screenshot({ path: `.screenshots/b2-t2-lobby-staff-${size.name}.png`, fullPage: true });
    });

    test(`/competitions（學生：看不到草稿與新增按鈕）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto("/competitions");
      await expect(page.getByText("全國大學生黑客松")).toBeVisible();
      await expect(page.getByText("還沒發布的草稿")).toHaveCount(0);
      await page.screenshot({ path: `.screenshots/b2-t2-lobby-student-${size.name}.png`, fullPage: true });
    });

    test(`/competitions/new（帶錯誤訊息）@ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto("/competitions/new");
      await page.getByRole("button", { name: "存草稿" }).click();
      await expect(page.getByText("請填比賽名稱")).toBeVisible();
      await expect(page.getByText("請填正確的官方連結")).toBeVisible();
      await expect(page.getByText("請填報名截止日")).toBeVisible();
      await page.screenshot({ path: `.screenshots/b2-t2-new-form-errors-${size.name}.png`, fullPage: true });
    });
  }
});
