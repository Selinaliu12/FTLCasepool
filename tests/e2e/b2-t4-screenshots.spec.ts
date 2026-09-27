import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// b2-t4（比賽線的階段、燈號、看板）視覺自我檢查截圖，跟 b2-t3 同一套規矩：預設跳過、
// 自己控制種子資料、結束後還原。執行方式：
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/b2-t4-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND === "2" ? "round2" : "round1";

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

async function setupConfirmedEntry(overdueSignup: boolean): Promise<{ groupA: string }> {
  await resetDb();
  const seed = await seedSemester({ acknowledged: true });
  const db = serviceSupabase();

  const signupDeadline = overdueSignup
    ? new Date(Date.now() - 96 * 3_600_000).toISOString()
    : "2099-12-01T15:59:59.999Z";

  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "全國大學生黑客松",
      url: "https://example.com/hackathon",
      signup_deadline: signupDeadline,
      submission_deadline: "2099-12-15T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (competitionError) throw competitionError;

  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .insert({
      group_id: seed.groupA,
      competition_id: competition.id,
      created_by: "a1@g.nccu.edu.tw",
      confirmed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (entryError) throw entryError;

  const { error: lineError } = await db.from("lines").insert({ group_id: seed.groupA, kind: "competition", entry_id: entry.id });
  if (lineError) throw lineError;

  return { groupA: seed.groupA };
}

// fix round 1：得獎的線沒有系統燈，改顯示成果徽章——需要一組截圖確認 UI 真的長這樣。
async function setupAwardedEntry(): Promise<void> {
  await resetDb();
  const seed = await seedSemester({ acknowledged: true });
  const db = serviceSupabase();

  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "全國大學生黑客松",
      url: "https://example.com/hackathon",
      signup_deadline: "2026-01-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (competitionError) throw competitionError;

  const { error: entryError } = await db.from("competition_entries").insert({
    group_id: seed.groupA,
    competition_id: competition.id,
    created_by: "a1@g.nccu.edu.tw",
    confirmed_at: new Date("2026-01-01T00:00:00Z").toISOString(),
    result: "awarded",
  });
  if (entryError) throw entryError;
  const { data: entry } = await db
    .from("competition_entries")
    .select("id")
    .eq("group_id", seed.groupA)
    .eq("competition_id", competition.id)
    .single();

  const { error: lineError } = await db.from("lines").insert({ group_id: seed.groupA, kind: "competition", entry_id: entry!.id });
  if (lineError) throw lineError;
}

test.describe(`b2-t4 視覺自我檢查截圖 ${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  test.beforeAll(() => {
    fs.mkdirSync(".screenshots", { recursive: true });
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`/my-group（比賽區塊：狀態、燈號、三個階段）@ ${size.name}`, async ({ page }) => {
      await setupConfirmedEntry(true);
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto("/my-group");
      await expect(page.getByText("全國大學生黑客松").first()).toBeVisible();
      await expect(page.getByText("報名", { exact: true })).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t4-my-group-stages-${size.name}.png`, fullPage: true });
    });

    test(`/dashboard（比賽線出現在組卡）@ ${size.name}`, async ({ page }) => {
      await setupConfirmedEntry(true);
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
      await page.goto("/dashboard");
      await expect(page.getByText("全國大學生黑客松").first()).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t4-dashboard-competition-line-${size.name}.png`, fullPage: true });
    });

    // fix round 1：得獎的線只顯示成果徽章，不顯示 LightBadge。
    test(`/my-group（得獎的線只顯示成果徽章，不顯示燈號）@ ${size.name}`, async ({ page }) => {
      await setupAwardedEntry();
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto("/my-group");
      await expect(page.getByText("全國大學生黑客松").first()).toBeVisible();
      await expect(page.getByText("得獎")).toBeVisible();
      await page.screenshot({ path: `.screenshots/${ROUND}-b2-t4-my-group-ended-line-${size.name}.png`, fullPage: true });
    });
  }
});
