import { test, expect } from "@playwright/test";
import { resetDb, seedSemester } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 5（規格 §16）：管理員在「成員」區塊按「新增成員」加一個專案生，那位同學馬上就能登入、
// 看到自己組。重建資料庫，跑完還原全域種子。
test.describe.serial("管理員新增成員", () => {
  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("新增一個專案生 → 出現在成員清單 → 本人登入看到自己組", async ({ page, browser }) => {
    await resetDb();
    await seedSemester();

    await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
    const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
    await expect(card.getByText("甲一", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "新增成員" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("學校信箱").fill("newbie@g.nccu.edu.tw");
    await dialog.getByLabel("姓名").fill("新同學");
    await dialog.getByLabel("學號").fill("113701001");
    await dialog.getByLabel("系級").fill("資科一");
    await dialog.getByRole("combobox", { name: "組別" }).click();
    await page.getByRole("option", { name: "第2組" }).click();
    await dialog.getByRole("button", { name: "新增" }).click();

    await expect(page.getByText("已新增新同學")).toBeVisible();
    await expect(dialog).toBeHidden();
    const row = card.getByRole("row").filter({ hasText: "新同學" });
    await expect(row).toContainText("newbie@g.nccu.edu.tw");
    await expect(row).toContainText("第2組專案生");

    // 已經有這個身份：錯誤顯示在表單裡
    await card.getByRole("button", { name: "新增成員" }).click();
    await dialog.getByLabel("學校信箱").fill("newbie@g.nccu.edu.tw");
    await dialog.getByLabel("姓名").fill("新同學");
    await dialog.getByLabel("學號").fill("113701001");
    await dialog.getByLabel("系級").fill("資科一");
    await dialog.getByRole("combobox", { name: "組別" }).click();
    await page.getByRole("option", { name: "第2組" }).click();
    await dialog.getByRole("button", { name: "新增" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("這個人已經有這個身份");
    await expect(dialog.getByRole("button", { name: "新增" })).toBeEnabled();

    const ctx = await browser.newContext();
    const student = await ctx.newPage();
    await loginAndPassWelcome(student, "newbie@g.nccu.edu.tw", /\/my-group$/);
    await expect(student.getByText("第2組").first()).toBeVisible();
    await ctx.close();
  });
});

// Task 6（規格 §16 第 3、4 點）：管理員在「成員」區塊按「編輯」改姓名／學號／系級／信箱，
// 名單上信箱打錯的同學改成正確信箱後就能登入。
test.describe.serial("管理員編輯成員", () => {
  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("改信箱後，新信箱能登入、舊信箱不行；同時改姓名／學號／系級", async ({ page, browser }) => {
    await resetDb();
    await seedSemester();

    await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
    const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
    const row = card.getByRole("row").filter({ hasText: "甲二" });
    await row.getByRole("button", { name: "編輯" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("學校信箱").fill("a2-fixed@g.nccu.edu.tw");
    await dialog.getByLabel("姓名").fill("甲二改");
    await dialog.getByLabel("學號").fill("110701002");
    await dialog.getByLabel("系級").fill("資科三");
    await dialog.getByRole("button", { name: "儲存" }).click();

    await expect(page.getByText("已更新甲二改的資料")).toBeVisible();
    await expect(dialog).toBeHidden();
    const updatedRow = card.getByRole("row").filter({ hasText: "甲二改" });
    await expect(updatedRow).toContainText("a2-fixed@g.nccu.edu.tw");

    const ctx = await browser.newContext();
    const student = await ctx.newPage();
    await loginAndPassWelcome(student, "a2-fixed@g.nccu.edu.tw", /\/my-group$/);
    await expect(student.getByText("甲二改").first()).toBeVisible();
    await ctx.close();

    await page.goto("/test-login?email=a2%40g.nccu.edu.tw");
    await expect(page).toHaveURL(/\/not-in-roster$/);
  });

  test("舊信箱已有交件紀錄時改信箱被拒；錯誤顯示在表單裡", async ({ page }) => {
    await resetDb();
    await seedSemester({ acknowledged: true });
    const service = (await import("../integration/helpers")).service();
    const { data: line } = await service.from("lines").select("id, group_id").limit(1).single();
    const { data: period } = await service.from("periods").select("id").limit(1).single();
    await service.from("progress_reports").insert({
      line_id: line!.id, period_id: period!.id, light: "green", did: "x", blocked: "無", next_steps: "x",
      submitted_by: "a1@g.nccu.edu.tw", pdf_key: "reports/e2e/period1.pdf", pdf_size: 10,
      pdf_uploaded_at: new Date().toISOString(), pdf_uploaded_by: "a1@g.nccu.edu.tw",
    });

    await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
    const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
    const row = card.getByRole("row").filter({ hasText: "甲一" }).first();
    await row.getByRole("button", { name: "編輯" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("學校信箱").fill("a1-new@g.nccu.edu.tw");
    await dialog.getByRole("button", { name: "儲存" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("這個人已經有紀錄，不能改信箱；請移除後用新信箱新增");
    await expect(dialog.getByRole("button", { name: "儲存" })).toBeEnabled();
  });

  // F1（fix round 1，controller-required test）：姓名清空、同時改信箱 → 一次呼叫的 editPerson()
  // 在同一個交易裡驗證，錯誤顯示在對話框裡、對話框不會被 revalidate 卸載，信箱與姓名都沒被改動。
  test("姓名清空、同時改信箱 → 錯誤顯示在表單裡，信箱與姓名都沒被改動", async ({ page }) => {
    await resetDb();
    await seedSemester();

    await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
    const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
    const row = card.getByRole("row").filter({ hasText: "甲二" });
    await row.getByRole("button", { name: "編輯" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("學校信箱").fill("a2-cleared@g.nccu.edu.tw");
    await dialog.getByLabel("姓名").fill("");
    await dialog.getByRole("button", { name: "儲存" }).click();

    await expect(dialog.getByRole("alert")).toHaveText("姓名不能空白");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "儲存" })).toBeEnabled();

    // 對話框關掉之後，成員清單裡還是原本的信箱與姓名——什麼都沒被改動。
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(card.getByRole("row").filter({ hasText: "甲二" })).toContainText("a2@g.nccu.edu.tw");
    await expect(page.getByText("a2-cleared@g.nccu.edu.tw")).toHaveCount(0);
  });
});

// Task 7（規格 §16 第 5 點）：管理員移除一位專案生（要在確認視窗再按一次）→ 那位同學重新整理後
// 看到名單外畫面；成員清單預設不再列他，勾「顯示已離開」才看得到並標已離開。
test.describe.serial("管理員移除成員", () => {
  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("移除一位專案生 → 該生重新整理後看到名單外畫面", async ({ page, browser }) => {
    await resetDb();
    await seedSemester();

    const ctx = await browser.newContext();
    const student = await ctx.newPage();
    await loginAndPassWelcome(student, "b1@g.nccu.edu.tw", /\/my-group$/);

    await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
    const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
    await card.getByRole("button", { name: "移除乙一的第2組專案生身份" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("乙一的第2組專案生身份會標成已離開，之前交的進度保留");
    await dialog.getByRole("button", { name: "確認移除" }).click();
    await expect(page.getByText("已移除乙一的第2組專案生身份")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(card.getByText("乙一", { exact: true })).toHaveCount(0);

    await card.getByRole("checkbox", { name: "顯示已離開" }).click();
    await expect(card.getByRole("row").filter({ hasText: "乙一" })).toContainText("第2組專案生（已離開）");

    await student.reload();
    await expect(student).toHaveURL(/\/not-in-roster$/);
    await expect(student.getByText("你不在本學期名單中，請聯絡幹部")).toBeVisible();
    await ctx.close();
  });
});
