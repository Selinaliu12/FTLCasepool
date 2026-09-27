import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

function serviceSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

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

// b2-t5：學生上傳報名階段的 PDF → 看到待審／可修改到。跟 entries.spec.ts 同一套種子與
// 登入流程，這裡直接用 service client 建一筆已確認的報名（跳過掛比賽／確認報名這兩步，
// 專注測 Task 5 的上傳流程本身）。
test.describe.serial("比賽階段上傳", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  test.beforeAll(async () => {
    await resetDb();
    seed = await seedSemester({ acknowledged: true });

    const db = serviceSupabase();
    const { data: competition, error: competitionError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "全國黑客松",
        url: "https://example.com/hackathon",
        signup_deadline: "2099-12-31T15:59:59.999Z",
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
    entryId = entry.id as string;

    const { error: lineError } = await db
      .from("lines")
      .insert({ group_id: seed.groupA, kind: "competition", entry_id: entryId });
    if (lineError) throw lineError;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("學生上傳報名階段的 PDF → 看到待審 · 可修改到", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

    await page.goto(`/my-group/competitions/${entryId}`);
    await expect(page.getByText("全國黑客松")).toBeVisible();
    await expect(page.getByText("報名", { exact: true })).toBeVisible();

    await page.locator('input[aria-label="上傳報名"]').setInputFiles(path.join(__dirname, "../fixtures/sample.pdf"));

    await expect(page.getByText(/已上傳第 1 版 · 待審 · 可修改到/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "換 PDF" })).toBeVisible();
    await expect(page.getByRole("button", { name: "撤回" })).toBeVisible();
  });
});
