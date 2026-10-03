import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 5 視覺自我檢查：管理員頁「成員」區塊（清單、顯示已離開、新增成員視窗＋錯誤）。
// 預設跳過；CAPTURE_SCREENSHOTS=1 SCREENSHOT_ROUND=1|2 npx playwright test tests/e2e/tpl-t5-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`tpl-t5 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。");

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();
    const db = service();
    await db.from("members").update({ student_id: "110701001", dept_year: "資科三" }).eq("email", "a1@g.nccu.edu.tw");
    await db.from("members").insert([
      { semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "officer", student_id: "110701001", dept_year: "資科三" },
      { semester_id: seed.semesterId, email: "left@g.nccu.edu.tw", name: "林已離開", role: "student", group_id: seed.groupB, student_id: "111", dept_year: "財管二", left_at: new Date().toISOString() },
      { semester_id: seed.semesterId, email: "averyveryverylongemailaddress2026@g.nccu.edu.tw", name: "歐陽長名字同學", role: "student", group_id: seed.groupA, student_id: "112345678", dept_year: "國際經營與貿易學系四年級" },
    ]);
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`成員區塊 ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "admin@g.nccu.edu.tw", /\/admin$/);
      const card = page.locator('[data-slot="card"]').filter({ has: page.getByText("成員", { exact: true }) });
      await card.scrollIntoViewIfNeeded();
      const prefix = `.screenshots/round${ROUND}-tpl-t5-${size.name}`;
      await card.screenshot({ path: `${prefix}-members.png` });
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      fs.writeFileSync(`${prefix}-scrollwidth.txt`, String(scrollW));

      await card.getByText("顯示已離開").click();
      await card.screenshot({ path: `${prefix}-members-left.png` });

      await card.getByRole("button", { name: "新增成員" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("信箱").fill("a1@g.nccu.edu.tw");
      await dialog.getByLabel("姓名").fill("甲一改");
      await dialog.getByRole("combobox", { name: "組別" }).click();
      await page.getByRole("option", { name: "第2組" }).click();
      await dialog.getByRole("button", { name: "新增" }).click();
      await dialog.getByRole("alert").waitFor();
      await expect(dialog.getByRole("button", { name: "新增" })).toBeEnabled();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${prefix}-dialog-error.png` });
    });
  }
});
