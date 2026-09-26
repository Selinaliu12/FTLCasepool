import { test, expect } from "@playwright/test";
import { resetDb, seedSemester } from "../integration/helpers";

// 這份測試會清空、重建整個資料庫（建立自己的學期），跟其他 e2e 測試依賴的全域種子資料衝突，
// 所以用 serial 模式跑在自己的 worker 裡，結束後把種子資料還原給其他測試用。
test.describe.serial("管理員設定", () => {
  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("建學期、匯入名單、填期別、指派專案幹部；重新整理後勾選仍在", async ({ page }) => {
    await resetDb();

    await page.goto("/test-login?email=admin@g.nccu.edu.tw");
    await expect(page).toHaveURL(/\/admin/);

    await page.getByLabel("學期名稱").fill("115-1");
    await page.getByRole("button", { name: "建立學期" }).click();
    await expect(page.getByText("目前學期：115-1")).toBeVisible();

    const csv = [
      "email,姓名,角色,組別,專案名稱",
      "s1@g.nccu.edu.tw,甲一,專案生,第1組,專案A",
      "s2@g.nccu.edu.tw,甲二,專案生,第1組,專案A",
      "s3@g.nccu.edu.tw,乙一,專案生,第2組,專案B",
      "pm1@g.nccu.edu.tw,幹部,專案幹部,,",
    ].join("\n");
    await page.getByLabel("貼上名單 CSV").fill(csv);
    await page.getByRole("button", { name: "匯入名單" }).click();
    await expect(page.getByText("已匯入 4 人")).toBeVisible();

    await page.getByLabel("第 1 期日期").fill("2026-10-01");
    await page.getByRole("button", { name: "新增一期" }).click();
    await page.getByLabel("第 2 期日期").fill("2026-11-01");
    await page.getByRole("button", { name: "儲存期別" }).click();
    await expect(page.getByText("已儲存")).toBeVisible();

    const pmCheckbox = page.getByRole("checkbox", { name: "幹部 負責 第1組" });
    await pmCheckbox.click();
    await expect(pmCheckbox).toBeChecked();

    await page.reload();
    await expect(page.getByRole("checkbox", { name: "幹部 負責 第1組" })).toBeChecked();
  });
});
