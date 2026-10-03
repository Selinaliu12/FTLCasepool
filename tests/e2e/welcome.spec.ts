import { test, expect } from "@playwright/test";

test("第一次登入看到說明頁，按了才能進去；沒按之前打其他網址會被彈回；第二次登入直接進去", async ({ page }) => {
  // a1@ 是種子名單裡的專案生，還沒按過「我已了解」。
  await page.goto("/test-login?email=a1@g.nccu.edu.tw");
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText("使用前請先閱讀")).toBeVisible();
  await expect(
    page.getByText("學期中，你的進度內容只有自己組員、負責你們組的專案幹部和系統管理員看得到；專案幹部出的作業，出題的幹部也看得到。其他幹部只看得到燈號與階段。")
  ).toBeVisible();
  await expect(page.getByText("期末資料會匯出到社團雲端硬碟，只有幹部看得到。")).toBeVisible();
  await expect(page.getByText("系統管理員維護時技術上碰得到所有資料。")).toBeVisible();
  await expect(
    page.getByText("上傳後 2 小時內可以刪除重傳，之後鎖定、永久保存。替換檔案後，繳交時間以新檔案為準。")
  ).toBeVisible();
  await expect(page.getByText("只收 PDF，每份最大 20MB。")).toBeVisible();

  // 沒按之前打其他網址（/dashboard 這條路由已經存在），一律被彈回 /welcome。
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/welcome$/);

  await page.getByRole("button", { name: "我已了解" }).click();
  // a1 是專案生：RootPage 會把已承認、有名單的專案生導去自己組的頁面。
  await expect(page).toHaveURL(/\/my-group/);

  // 再登入一次：不用再按，直接進去。
  await page.goto("/test-login?email=a1@g.nccu.edu.tw");
  await expect(page).toHaveURL(/\/my-group/);
});
