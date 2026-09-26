import { test, expect } from "@playwright/test";
import { resetDb, seedSemester, ensureLocalStorageBucket, uploadTestPdf } from "../integration/helpers";

// 跟 dashboard.spec.ts 一樣：自己控制種子資料，不依賴其他測試檔案先跑過，結束後把種子資料
// 還原給其他測試用（single-worker，全部 e2e 測試共用同一個本機 Supabase）。
test.describe.serial("看已交內容", () => {
  let groupAId: string;

  test.beforeAll(async () => {
    await resetDb();
    const seed = await seedSemester();
    groupAId = seed.groupA;
    await ensureLocalStorageBucket();

    // seedSemester() 的種子報告只在資料庫留了一筆 pdf_key（"reports/lineA/period1.pdf"），
    // 沒有真的把檔案放進本機 Storage；下載這個行為要打真的預簽網址，得先把一份真的 PDF
    // 放到同一把 key，下載才拿得到內容而不是 404。
    const pdf = new TextEncoder().encode("%PDF-1.7\n%e2e-fixture\n");
    await uploadTestPdf("reports/lineA/period1.pdf", pdf);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  test("專案幹部從看板點進第1組、看到三句話、按下載拿到 PDF", async ({ page }) => {
    await page.goto("/test-login?email=pm@g.nccu.edu.tw");
    await Promise.race([
      page.waitForURL(/\/dashboard$/),
      page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
    ]);
    if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "我已了解" }).click();
    }
    await expect(page).toHaveURL(/\/dashboard$/);

    const firstCard = page.locator("[data-slot='card']").filter({ hasText: "第1組" });
    await firstCard.getByRole("link", { name: "看內容" }).click();

    await expect(page).toHaveURL(new RegExp(`/groups/${groupAId}$`));
    await expect(page.getByRole("heading", { name: "第1組" })).toBeVisible();

    // 展開第1期，看到三句話與誰交。
    await page.getByText(/已交 · 甲一 · /).first().click();
    await expect(page.getByText("完成初版原型")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下載 PDF" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("第1組");
    expect(download.suggestedFilename()).toContain("第1期");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
  });

  test("其他幹部看不到「看內容」連結，打網址直接 404", async ({ page }) => {
    await page.goto("/test-login?email=off@g.nccu.edu.tw");
    await Promise.race([
      page.waitForURL(/\/dashboard$/),
      page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
    ]);
    if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "我已了解" }).click();
    }
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("link", { name: "看內容" })).toHaveCount(0);

    // Fix round 1：這個路由原本掛了 loading.tsx，Next.js 對有 loading.tsx 的區段會用串流
    // render，回應在 notFound() 真的跑到之前就已經送出 200 的 header 了（實測：dev 跟
    // `next build && next start` 都回 200，即使畫面顯示的是 404 頁）。拿掉 loading.tsx
    // 後（見 controller ruling 4），這個路由改成同步 render，notFound() 才能在送出
    // header 前把狀態碼定案——已用 `next build && next start -p 3100`，登入 off@ 拿真的
    // session cookie 直接 curl 這個網址驗證過，狀態碼確實是 404（dev server 現在也一樣）。
    const response = await page.goto(`/groups/${groupAId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });
});
