import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function setupConfirmedEntry() {
  await resetDb();
  const seed = await seedSemester({ acknowledged: true });
  const db = serviceSupabase();

  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "全國大學生黑客松",
      url: "https://example.com/hackathon",
      signup_deadline: "2099-12-01T15:59:59.999Z",
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

  return { competitionId: competition.id as string, entryId: entry.id as string, seed };
}

async function loginAndPassWelcome(page: import("@playwright/test").Page, email: string, waitForUrl: RegExp) {
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

test.describe.serial("比賽線的階段、燈號、看板（batch 2 task 4）", () => {
  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("已確認報名的組在 /my-group 看得到三個階段", async ({ page }) => {
    await setupConfirmedEntry();
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await page.goto("/my-group");

    await expect(page.getByText("全國大學生黑客松")).toBeVisible();
    await expect(page.getByText("準備中")).toBeVisible();
    await expect(page.getByText("報名")).toBeVisible();
    await expect(page.getByText("繳件")).toBeVisible();
    await expect(page.getByText("決賽")).toBeVisible();
    await expect(page.getByText("尚未公布")).toBeVisible(); // 決賽日期沒填
    await expect(page.getByText("未交").first()).toBeVisible();
  });

  test("比賽線出現在幹部看板的組卡上", async ({ page }) => {
    await setupConfirmedEntry();
    await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
    await page.goto("/dashboard");

    const cards = page.locator("[data-slot='card']");
    const groupACard = cards.filter({ hasText: "第1組" });
    await expect(groupACard.getByText("全國大學生黑客松")).toBeVisible();
  });
});
