import { test, expect } from "@playwright/test";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Final whole-branch review F1：管理員也在名單上（這裡示範兼其他幹部），把目前身份切離「管理員」
// 之後打 /admin 要被導走，不能停留在管理員頁。requireAdmin() 那一層（動作被拒）已經在
// tests/integration/admin-actions.test.ts 覆蓋；這支補上頁面層的導向，因為 AdminPage 是
// async server component，vitest 沒有現成的方式渲染／攔截它的 redirect()，用短短一支 e2e 測。
test.describe.serial("管理員在名單上、切離管理員身份後打 /admin", () => {
  test.beforeAll(async () => {
    await resetDb();
    const seed = await seedSemester({ acknowledged: true });
    const db = service();
    await db
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "admin@g.nccu.edu.tw", name: "管理員兼其他幹部", role: "officer", group_id: null });
    await db.from("acknowledgements").insert({ semester_id: seed.semesterId, email: "admin@g.nccu.edu.tw" });
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("切到其他幹部身份 → /admin 被導到其他幹部的首頁（/dashboard），不停留在管理員頁", async ({ page }) => {
    await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
    await page.getByRole("button", { name: "身份：管理員 ▾" }).click();
    await page.getByRole("menuitemradio", { name: "其他幹部" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // 目前身份還是「其他幹部」時，直接打 /admin 的網址一樣被導走。
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
