import { test, expect } from "@playwright/test";

test("不在名單上的學校帳號看到提示、進不去", async ({ page }) => {
  await page.goto("/test-login?email=stranger@g.nccu.edu.tw");
  await expect(page.getByText("你不在本學期名單中，請聯絡幹部")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/not-in-roster/);
});
