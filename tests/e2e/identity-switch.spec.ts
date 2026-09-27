import { test, expect, type Page } from "@playwright/test";
import { resetDb, seedSemester, service } from "../integration/helpers";

// Adjustments Task 3（規格 §14 第 3 點）：頁首身份切換。多組專案生切到第3組 → 組頁換成第3組；
// 切換後打開舊組（第1組）的報名頁 → 跟別組一樣是找不到（404）。
let entryA = "";

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

test.describe.serial("頁首身份切換", () => {
  test.beforeAll(async () => {
    await resetDb();
    const seed = await seedSemester();
    const db = service();
    const { data: g } = await db.from("groups").insert({ semester_id: seed.semesterId, name: "第3組", project_name: "專案C" }).select().single();
    await db.from("lines").insert({ group_id: g!.id, kind: "project" });
    await db.from("members").insert([
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: seed.groupA },
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: g!.id },
    ]);
    const { data: comp } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2099-10-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    const { data: entry } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: comp!.id, created_by: "multi@g.nccu.edu.tw" })
      .select()
      .single();
    entryA = entry!.id as string;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("單一身份的人看不到身份切換", async ({ page }) => {
    await loginAndPassWelcome(page, "a2@g.nccu.edu.tw", /\/my-group$/);
    await expect(page.getByRole("button", { name: /^身份：/ })).toHaveCount(0);
  });

  test("多組專案生：切到第3組 → 組頁換成第3組；舊組的報名頁 404；再切回第1組看得到", async ({ page }) => {
    await loginAndPassWelcome(page, "multi@g.nccu.edu.tw", /\/my-group$/);
    await expect(page.getByRole("heading", { name: "第1組", exact: false }).first()).toBeVisible();
    await page.goto(`/my-group/competitions/${entryA}`);
    await expect(page.getByRole("heading", { name: "黑客松" })).toBeVisible();

    await page.getByRole("button", { name: "身份：第1組專案生 ▾" }).click();
    await page.getByRole("menuitemradio", { name: "第3組專案生" }).click();
    await expect(page).toHaveURL(/\/my-group$/);
    await expect(page.getByRole("button", { name: "身份：第3組專案生 ▾" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "第3組", exact: false }).first()).toBeVisible();

    const res = await page.goto(`/my-group/competitions/${entryA}`);
    expect(res?.status()).toBe(404);

    // 重新登入（cookie 還在）→ 進上次用的身份。
    await page.goto("/");
    await expect(page.getByRole("button", { name: "身份：第3組專案生 ▾" })).toBeVisible();

    await page.getByRole("button", { name: "身份：第3組專案生 ▾" }).click();
    await page.getByRole("menuitemradio", { name: "第1組專案生" }).click();
    await expect(page.getByRole("button", { name: "身份：第1組專案生 ▾" })).toBeVisible();
    await page.goto(`/my-group/competitions/${entryA}`);
    await expect(page.getByRole("heading", { name: "黑客松" })).toBeVisible();
  });

  test("竄改 cookie 成不存在的身份 → 退回第一個合法身份（第1組），不報錯", async ({ page, context }) => {
    await loginAndPassWelcome(page, "multi@g.nccu.edu.tw", /\/my-group$/);
    await context.addCookies([{ name: "ftl_identity", value: "00000000-0000-0000-0000-000000000000", url: "http://localhost:3000" }]);
    await page.goto("/my-group");
    await expect(page.getByRole("button", { name: "身份：第1組專案生 ▾" })).toBeVisible();
  });
});
