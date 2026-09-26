import { test, expect } from "@playwright/test";

// global-setup（seedSemester()）裡已經先幫第1組（a1／a2 兩人）交過第1期，pdf_uploaded_at
// 是「剛剛」，還在 2 小時內，可以測完整的「修改 → 儲存 → 撤回」流程。這裡故意用 a2（不是
// 交出這份報告的 a1）登入，順便驗證「該組任何組員都可以修改」；用 a2 而不是 a1，是因為
// welcome.spec.ts 依賴 a1 還沒按過「我已了解」（同一個 playwright worker 依序執行，
// 兩邊都碰 a1 會互相干擾）。
test("交件後 2 小時內同組組員可以修改一句話、儲存後繳交時間不變，之後撤回回到未交", async ({ page }) => {
  await page.goto("/test-login?email=a2@g.nccu.edu.tw");
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByRole("button", { name: "我已了解" }).click();
  await expect(page).toHaveURL(/\/my-group$/);

  // 第1期已交：連結文字是「查看這期」，旁邊會有「可修改到 …」。
  await expect(page.getByText(/可修改到 \d{1,2}\/\d{2}（[日一二三四五六]）\d{2}:\d{2}/).first()).toBeVisible();

  const originalSubmittedAtText = await page.getByText(/已交 · 甲一 · /).first().textContent();

  await page.getByRole("link", { name: "查看這期" }).first().click();
  await expect(page).toHaveURL(/\/my-group\/periods\/.+/);

  await expect(page.getByText(/可修改到 \d{1,2}\/\d{2}（[日一二三四五六]）\d{2}:\d{2}/)).toBeVisible();

  await page.getByRole("button", { name: "修改" }).click();
  await page.getByLabel("接下來要做什麼").fill("改過的下一步內容");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByRole("button", { name: "修改" })).toBeVisible();

  // 重新整理，確定內容真的寫進資料庫（不是只有前端 local state 看起來改了），
  // 且繳交時間不變。
  await page.reload();
  await expect(page.getByText("改過的下一步內容")).toBeVisible();
  await expect(page.getByText(originalSubmittedAtText ?? "")).toBeVisible();

  // 撤回：先跳確認框，而且是撤回專用的那個（不是換 PDF 逾期那個），按「確定撤回」才會真的動作。
  await page.getByRole("button", { name: "撤回" }).click();
  await expect(page.getByText("確定要撤回這一期嗎？")).toBeVisible();
  await expect(page.getByText("撤回後這一筆報告跟 PDF 都會被刪除，不會留下紀錄，這一期會回到未交。")).toBeVisible();
  await page.getByRole("button", { name: "確定撤回" }).click();

  await expect(page).toHaveURL(/\/my-group$/);
  // 第1期回到「未交」：連結文字變回「交這期進度」。
  await expect(page.getByRole("link", { name: "交這期進度" }).first()).toBeVisible();
});
