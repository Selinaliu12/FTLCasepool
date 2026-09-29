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

    // 建立學期之後，管理員本身也變成 kind "ok"（有真的 semesterId），跟其他人一樣要按過
    // 「我已了解」才能繼續（見 (app)/layout.tsx；no_semester 才會跳過檢查，建立學期之前那次
    // 進入 /admin 就是 no_semester，所以沒被擋）。這裡先等「/admin 顯示新學期」或「跳到
    // /welcome」兩者其中一個先出現——不能只比對網址，因為點擊當下網址還是 /admin，之後才會
    // 非同步導頁，直接讀 page.url() 會抓到還沒導頁的舊網址。
    await Promise.race([
      page.getByText("目前學期：115-1").waitFor({ state: "visible" }),
      page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
    ]);
    if (await page.getByRole("button", { name: "我已了解" }).isVisible()) {
      await page.getByRole("button", { name: "我已了解" }).click();
    }
    await expect(page.getByText("目前學期：115-1")).toBeVisible();

    const csv = [
      "email,姓名,角色,學號,系級,組別,專案名稱",
      "s1@g.nccu.edu.tw,甲一,專案生,110701001,資科三,第1組,專案A",
      "s2@g.nccu.edu.tw,甲二,專案生,110701002,資科三,第1組,專案A",
      "s3@g.nccu.edu.tw,乙一,專案生,110701003,資科三,第2組,專案B",
      "pm1@g.nccu.edu.tw,幹部,專案幹部,,,,",
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
    // 勾選是樂觀更新：畫面先打勾、server action 之後才送出。等 server action 回應再重新整理，
    // 不然 dev 模式下（頁面比較重、送出前有一小段延遲）reload 可能搶在請求送出之前，把它取消掉。
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/admin"));
    await pmCheckbox.click();
    await expect(pmCheckbox).toBeChecked();
    await saved;

    await page.reload();
    await expect(page.getByRole("checkbox", { name: "幹部 負責 第1組" })).toBeChecked();

    // §14：換組選單顯示「姓名（學號）· 第N組」。
    await page.getByLabel("選擇成員").click();
    await expect(page.getByRole("option", { name: "甲一（110701001）· 第1組" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  // §14：舊資料相容——沒有學號的既有成員，換組選單要顯示「—」而不是壞掉。
  test("舊成員沒有學號，換組選單顯示「—」", async ({ page }) => {
    await resetDb();
    await seedSemester();

    await page.goto("/test-login?email=admin@g.nccu.edu.tw");
    await Promise.race([
      page.getByText("目前學期：115-1").waitFor({ state: "visible" }),
      page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
    ]);
    if (await page.getByRole("button", { name: "我已了解" }).isVisible()) {
      await page.getByRole("button", { name: "我已了解" }).click();
    }
    await expect(page.getByText("目前學期：115-1")).toBeVisible();

    await page.getByLabel("選擇成員").click();
    await expect(page.getByRole("option", { name: "甲一（—）· 第1組" })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
