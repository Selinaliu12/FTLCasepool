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
    await expect(card.getByRole("cell", { name: "甲一" })).toBeVisible();

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
