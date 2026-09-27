import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester } from "../integration/helpers";

// src/server/supabase.ts 的 createServiceSupabase() 開頭是 `import "server-only"`，在
// Playwright 的一般 node 行程（不是 Next 的 bundler）直接 import 會無條件丟例外，跟
// b2-t2-screenshots.spec.ts 一樣直接用 @supabase/supabase-js 建一個 service-role client。
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

// 跟其他 e2e 檔案一樣：自己控制種子資料，結束後還原，讓其他測試檔案不受影響
// （single-worker，全部 e2e 測試共用同一個本機 Supabase）。
test.describe.serial("競賽大廳", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let realDraftId: string;

  test.beforeAll(async () => {
    await resetDb();
    seed = await seedSemester();

    // Minor 1（controller ruling，fix round 1）：學生打編輯頁的 404 測試要用一個真實存在的草稿
    // id，不能只測「亂填的 id／根本不存在的 id」——那種輸入不管有沒有權限檢查本來就會 404，
    // 沒辦法證明「這場比賽真的存在、只是學生看不到」這條規則有在擋。
    const { data: draft, error } = await serviceSupabase()
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "只有幹部看得到的草稿",
        url: "https://example.com/hidden-draft",
        signup_deadline: "2026-12-01T15:59:59.999Z",
        status: "draft",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (error) throw error;
    realDraftId = draft.id as string;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("幹部新增→存草稿→發布→學生在大廳看到卡片", async ({ page }) => {
    await loginAndPassWelcome(page, "pm@g.nccu.edu.tw", /\/dashboard$/);

    await page.goto("/competitions");
    await expect(page.getByRole("heading", { name: "競賽大廳" })).toBeVisible();
    // Minor 6（controller ruling，fix round 1）：開放中區塊要有明確的「報名中」標題。
    await expect(page.getByRole("heading", { name: "報名中" })).toBeVisible();
    await page.getByRole("link", { name: "新增競賽" }).click();
    await expect(page).toHaveURL(/\/competitions\/new$/);

    await page.getByLabel("比賽名稱").fill("全國黑客松");
    await page.getByLabel("官方連結").fill("https://example.com/hackathon");
    await page.getByLabel("報名截止日期").fill("2026-12-31");

    await page.getByRole("button", { name: "存草稿" }).click();
    await expect(page).toHaveURL(/\/competitions\/[0-9a-f-]+\/edit$/);
    await expect(page.getByRole("button", { name: "發布" })).toBeVisible();
    const editUrl = page.url();

    // 草稿階段：回到大廳看得到「草稿」卡片。
    await page.goto("/competitions");
    await expect(page.getByText("草稿").first()).toBeVisible();
    await expect(page.getByText("全國黑客松")).toBeVisible();

    // 回到編輯頁按發布。
    await page.goto(editUrl);
    await page.getByRole("button", { name: "發布" }).click();
    await expect(page).toHaveURL(/\/competitions$/);

    // 學生登入後在大廳看得到這張已發布的卡片。
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await page.goto("/competitions");
    await expect(page.getByText("全國黑客松")).toBeVisible();
    await expect(page.getByRole("link", { name: "新增競賽" })).toHaveCount(0);
    await expect(page.getByText(/剩 \d+ 天|今天截止/)).toBeVisible();
    await expect(page.getByRole("link", { name: "官方連結" })).toHaveAttribute("href", "https://example.com/hackathon");
  });

  test("學生打 /competitions/new 與 /competitions/[id]/edit（真實存在的草稿）都是 404", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

    // Final review minor 6：/competitions 的 loading.tsx 放在 (lobby) route group 裡，不包住
    // new／edit——這裡同時斷言真的 404 狀態碼，不是串流之後才畫 404 畫面的 200。
    const newResponse = await page.goto("/competitions/new");
    expect(newResponse?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();

    // 用一個真實存在（beforeAll 建的）草稿 id，證明是「學生看不到這場比賽」擋下來的，
    // 不是單純因為 id 亂填／查無此列。
    const editResponse = await page.goto(`/competitions/${realDraftId}/edit`);
    expect(editResponse?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("網址不是 http/https 被擋，不能存草稿", async ({ page }) => {
    await loginAndPassWelcome(page, "off@g.nccu.edu.tw", /\/dashboard$/);
    await page.goto("/competitions/new");

    await page.getByLabel("比賽名稱").fill("測試賽");
    await page.getByLabel("官方連結").fill("javascript:alert(1)");
    await page.getByLabel("報名截止日期").fill("2026-12-31");
    await page.getByRole("button", { name: "存草稿" }).click();

    await expect(page.getByText("請填正確的官方連結")).toBeVisible();
    await expect(page).toHaveURL(/\/competitions\/new$/);
  });
});
