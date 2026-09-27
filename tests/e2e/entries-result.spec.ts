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

test.describe.serial("填比賽結果（batch 2 task 7）", () => {
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
        name: "全國大學生黑客松",
        url: "https://example.com/hackathon",
        signup_deadline: "2099-12-01T15:59:59.999Z",
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
      .insert({ group_id: seed.groupA, kind: "competition", entry_id: entry.id });
    if (lineError) throw lineError;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("組員填未入選 → 組頁與看板都顯示未入選、沒有燈號", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

    await page.goto(`/my-group/competitions/${entryId}`);
    await expect(page.getByText("比賽結果")).toBeVisible();

    await page.getByText("未入選", { exact: true }).click();
    await page.getByRole("button", { name: "更新結果" }).click();
    await expect(
      page.getByText("填了得獎或未入選後，這場比賽會結束，之後的階段不用再交。確定嗎？")
    ).toBeVisible();
    await page.getByRole("button", { name: "確定" }).click();

    // 儲存成功後 toast 消失、按鈕不再顯示送出中——用等待狀態穩定代替固定 sleep。
    await expect(page.getByRole("button", { name: "送出中…" })).toHaveCount(0);

    await page.goto("/my-group");
    await expect(page.getByRole("heading", { name: "比賽" })).toBeVisible();
    // seedSemester() 固定替第1組留了一筆專案線的紅燈點燈，跟這裡測的比賽線無關——把斷言範圍
    // 限定在這場比賽自己的卡片裡，不要對整頁找「紅燈」。
    const competitionCard = page.locator("[data-slot='card']").filter({ hasText: "全國大學生黑客松" });
    await expect(competitionCard.getByText("未入選")).toBeVisible();
    await expect(competitionCard.getByText("綠燈")).toHaveCount(0);
    await expect(competitionCard.getByText("黃燈")).toHaveCount(0);
    await expect(competitionCard.getByText("紅燈")).toHaveCount(0);

    await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
    await page.goto("/dashboard");
    const cards = page.locator("[data-slot='card']");
    const groupACard = cards.filter({ hasText: "第1組" });
    await expect(groupACard.getByText("全國大學生黑客松")).toBeVisible();
    await expect(groupACard.getByText("未入選")).toBeVisible();
  });
});
