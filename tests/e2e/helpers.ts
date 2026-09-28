import { expect, type Page } from "@playwright/test";

// Fix round 1 F7（controller ruling）：登入＋跳過「我已了解」這段流程被複製貼上進 adj-t2／
// adj-t3／adj-t4 的截圖腳本與 group-note.spec.ts，抽出來共用一份。用 test-login（本機
// ENABLE_TEST_LOGIN 開關）登入指定 email；如果這個帳號這學期還沒按過「我已了解」會先看到
// /welcome，按掉之後才會落地到 waitForUrl。
export async function loginAndPassWelcome(page: Page, email: string, waitForUrl: RegExp): Promise<void> {
  await page.goto(`/test-login?email=${email}`);
  await Promise.race([
    page.waitForURL(waitForUrl),
    page.getByRole("button", { name: "我已了解" }).waitFor({ state: "visible" }),
  ]);
  if (await page.getByRole("button", { name: "我已了解" }).isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "我已了解" }).click();
  }
  await expect(page).toHaveURL(waitForUrl);
}
