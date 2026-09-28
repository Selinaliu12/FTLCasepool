import { test, expect } from "@playwright/test";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Adjustments Task 5（規格 §14 第 8 點）：管理員透過確認視窗刪除有人交件的期別。
// seedSemester() 的第 1 期有第1組交的一份進度。這份測試會改動期別與進度，結束後把種子資料還原。
test.describe.serial("管理員刪除有人交件的期別", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  test.beforeAll(async () => {
    await resetDb();
    seed = await seedSemester();
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("刪除第 1 期 → 確認視窗列出交件組數，打「刪除」後才能確定；刪完期別與進度都不見", async ({ page }) => {
    await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);

    await page.getByRole("button", { name: "刪除第 1 期" }).click();
    await page.getByRole("button", { name: "儲存期別" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("第 1 期有 1 組交了進度，刪除會一併刪掉這些進度與檔案")).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "確定刪除" });
    await expect(confirm).toBeDisabled();

    await dialog.getByLabel("輸入「刪除」確認").fill("刪除");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("已儲存")).toBeVisible();

    const svc = service();
    const { data: periods } = await svc.from("periods").select("id, seq").eq("semester_id", seed.semesterId);
    expect(periods).toEqual([{ id: seed.periodIds[1], seq: 1 }]);
    const { count } = await svc
      .from("progress_reports")
      .select("id", { count: "exact", head: true })
      .eq("period_id", seed.periodIds[0]);
    expect(count).toBe(0);

    await page.reload();
    await expect(page.getByLabel("第 1 期日期")).toHaveValue("2026-11-01");
    await expect(page.getByLabel("第 2 期日期")).toHaveCount(0);
  });
});
