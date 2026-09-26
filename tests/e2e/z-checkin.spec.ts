import { test, expect } from "@playwright/test";

// a1@ 是種子名單裡第1組的專案生。檔名故意排在其他 e2e 測試後面（同一個 worker 依序執行，
// 見 edit-progress.spec.ts／submit-progress.spec.ts 的註解）：welcome.spec.ts 依賴 a1 還沒
// 按過「我已了解」，這支測試不能搶在它前面把 a1 的 acknowledgement 用掉，所以排到最後、
// 順便沿用「a1 這時候一定已經按過」的狀態（用跟 admin.spec.ts 一樣的兜底寫法，不寫死假設）。
// seedSemester() 已經幫第1組種過一筆紅燈 check-in（甲一、卡在資料串接），這裡點黃燈之後，
// 「最近回報」要換成這次點的、不是種子那筆舊的。
test("學生登入 → 組頁點一下這週燈號（黃燈）→ 看到『最近回報』更新，重新整理後還在", async ({ page }) => {
  await page.goto("/test-login?email=a1@g.nccu.edu.tw");
  await Promise.race([
    page.waitForURL(/\/my-group$/),
    page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
  ]);
  if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "我已了解" }).click();
  }
  await expect(page).toHaveURL(/\/my-group$/);

  await page.getByRole("button", { name: "點一下這週燈號" }).click();
  await expect(page.getByRole("button", { name: "黃燈", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "黃燈", exact: true }).click();
  await page.getByRole("button", { name: "送出" }).click();

  await expect(page.getByText("已記錄這週燈號")).toBeVisible();

  // 「黃燈 · 甲一 · 10/09（五）14:20」這種格式：燈號 · 姓名 · formatTaipei() 輸出。
  const latest = page.getByText(/黃燈 · 甲一 · \d{1,2}\/\d{2}（[日一二三四五六]）\d{2}:\d{2}/);
  await expect(latest).toBeVisible();

  await page.reload();
  await expect(latest).toBeVisible();
});
