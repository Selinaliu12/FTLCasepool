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

test.describe.serial("掛比賽、確認報名、取消報名", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  test.beforeAll(async () => {
    await resetDb();
    seed = await seedSemester({ acknowledged: true });

    await serviceSupabase()
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "全國黑客松",
        url: "https://example.com/hackathon",
        signup_deadline: "2099-12-31T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      });
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("學生掛比賽→勾參賽成員→確認報名→在 /my-group 看到這場比賽", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);

    await page.goto("/competitions");
    await expect(page.getByText("全國黑客松")).toBeVisible();
    await page.getByRole("button", { name: "掛到我們組" }).click();

    await expect(page).toHaveURL(/\/my-group\/competitions\/[0-9a-f-]+$/);
    await expect(page.getByText("未確認")).toBeVisible();

    // 甲一（自己）已經預先勾選，另外再勾甲二。
    await page.getByText("甲二", { exact: true }).click();
    await page.getByRole("button", { name: "確認報名" }).click();
    await page.getByRole("button", { name: "確定" }).click();

    await expect(page.getByText("準備中")).toBeVisible();
    await expect(page.getByText("甲一、甲二").or(page.getByText("甲二、甲一"))).toBeVisible();
    await expect(page.getByRole("button", { name: "編輯參賽成員" })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消報名" })).toBeVisible();

    // fix round 1：確認後還是可以編輯參賽成員（規格「確認後不能再改參賽成員以外的設定」）。
    // 把甲二取消勾選，只剩甲一。
    await page.getByRole("button", { name: "編輯參賽成員" }).click();
    await page.getByText("甲二", { exact: true }).click();
    await page.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByRole("button", { name: "編輯參賽成員" })).toBeVisible();
    await expect(page.getByText("甲一", { exact: true })).toBeVisible();

    await page.goto("/my-group");
    await expect(page.getByRole("heading", { name: "比賽" })).toBeVisible();
    await expect(page.getByText("全國黑客松")).toBeVisible();
    await expect(page.getByText("準備中")).toBeVisible();
  });

  // Minor 9（fix round 1）：真的點下去，不是只檢查連結存在——要走到報名頁才算數。
  // Final review minor 6：/my-group 的 loading.tsx 放在 (overview) route group 裡，不包住報名頁
  // ——找不到的報名要回真的 404 狀態碼（controller ruling 4 同一個理由）。
  test("找不到的報名頁回真的 404", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    const response = await page.goto("/my-group/competitions/00000000-0000-0000-0000-000000000000");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });

  test("大廳卡片顯示已掛到你們組，點連結回到報名頁", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await page.goto("/competitions");
    await page.getByRole("link", { name: "已掛到你們組" }).click();
    await expect(page).toHaveURL(/\/my-group\/competitions\/[0-9a-f-]+$/);
    await expect(page.getByText("全國黑客松")).toBeVisible();
  });

  test("取消報名後回到 /my-group 顯示已退出，且大廳可以重新掛", async ({ page }) => {
    await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
    await page.goto("/my-group");
    await page.getByText("全國黑客松").click();

    await page.getByRole("button", { name: "取消報名" }).click();
    await page.getByRole("button", { name: "確定取消報名" }).click();
    await expect(page).toHaveURL(/\/my-group$/);
    await expect(page.getByText("已退出")).toBeVisible();

    await page.goto("/competitions");
    await expect(page.getByRole("button", { name: "掛到我們組" })).toBeVisible();
  });
});
