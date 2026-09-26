import path from "node:path";
import { test, expect } from "@playwright/test";

// b1@ 是種子名單裡「第2組」的專案生，兩期都還沒交（跟第1組不同：seedSemester() 已經
// 先幫第1組交過第1期，用第2組才能測完整的「選檔 → 上傳 → 送出」流程）。
test("學生登入 → 組頁 → 交一期進度（上傳 PDF）→ 回組頁看到已交", async ({ page }) => {
  await page.goto("/test-login?email=b1@g.nccu.edu.tw");
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByRole("button", { name: "我已了解" }).click();
  await expect(page).toHaveURL(/\/my-group$/);

  await expect(page.getByText("第2組")).toBeVisible();

  // 兩期都還沒交，第一個「交這期進度」連結是第1期。
  await page.getByRole("link", { name: "交這期進度" }).first().click();
  await expect(page).toHaveURL(/\/my-group\/periods\/.+/);

  await page.getByRole("button", { name: "綠燈" }).click();
  await page.getByLabel("這兩週做了什麼").fill("完成介面雛形");
  await page.getByLabel("卡在哪裡").fill("沒有卡關");
  await page.getByLabel("接下來要做什麼").fill("下週開始串接後端");

  await page.locator('input[type="file"]').setInputFiles(path.join(__dirname, "../fixtures/sample.pdf"));

  await page.getByRole("button", { name: "送出" }).click();

  await expect(page).toHaveURL(/\/my-group/, { timeout: 15_000 });
  await expect(page.getByText("已送出，2 小時內可以修改")).toBeVisible();
  // 「已交 · 乙一 · 10/16（五）21:03」這種格式：姓名後面接 formatTaipei() 的輸出
  // （M/DD（週幾）HH:mm），不是只檢查有沒有出現名字。
  await expect(page.getByText(/已交 · 乙一 · \d{1,2}\/\d{2}（[日一二三四五六]）\d{2}:\d{2}/)).toBeVisible();
});
