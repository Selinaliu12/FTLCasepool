import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { resetDb, seedSemester, service } from "../integration/helpers";
import { loginAndPassWelcome } from "./helpers";

// Task 4 視覺自我檢查用的截圖腳本：詳細頁 /competitions/[id] 的滿版資料版本（樣張 B 全部區塊）
// 與舊比賽（只有必填欄位）版本。跟 adj-t2-screenshots.spec.ts 同一套規矩：預設跳過，明確帶
// CAPTURE_SCREENSHOTS=1 才會真的執行、把截圖存成檔案。
//
//   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/tpl-t4-screenshots.spec.ts
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1";
const ROUND = process.env.SCREENSHOT_ROUND ?? "1";

const SIZES = [
  { name: "1280", width: 1280, height: 800 },
  { name: "375", width: 375, height: 812 },
];

test.describe.serial(`tpl-t4 視覺自我檢查截圖 round${ROUND}`, () => {
  test.skip(!CAPTURE, "手動截圖用；預設跳過。執行方式見檔案開頭註解（CAPTURE_SCREENSHOTS=1）。");

  let fullId: string;
  let minimalId: string;

  test.beforeAll(async () => {
    fs.mkdirSync(".screenshots", { recursive: true });
    await resetDb();
    const seed = await seedSemester();

    const svc = service();
    const { data: full, error: fullError } = await svc
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "全國資料視覺化競賽",
        organizer: "資訊管理學會",
        theme: "資料驅動的公共議題",
        eligibility: "全國大專院校在學學生皆可組隊參加，每隊 3-5 人。",
        team_size: "3-5 人",
        prize: "冠軍獎金 10 萬元＋業界實習機會＋決賽入圍者皆可獲得紀念品",
        url: "https://example.com/dataviz-final",
        signup_deadline: "2026-11-01T09:00:00.000Z",
        submission_deadline: "2026-11-30T09:00:00.000Z",
        final_date: "2026-12-20T09:00:00.000Z",
        status: "published",
        summary: "用資料說一個能打動評審的公共議題故事",
        tags: ["數據分析", "ESG"],
        max_prize: 100000,
        perks: "決賽入圍隊伍可獲得業師一對一諮詢",
        info_session_at: "2026-10-15T10:00:00.000Z",
        signup_note: "上傳報名表 PDF",
        submission_note: "上傳完整作品說明與程式碼連結",
        final_note: "決賽當天需準備 10 分鐘簡報",
        final_format: "決賽於政治大學商學院進行，採現場報告形式",
        fee: "免費",
        documents: "身分證影本、在學證明",
        skills: "資料分析、視覺化設計、簡報能力",
        recommended: true,
        staff_note: "這場比賽往年很多組拿獎，\n鼓勵大家踴躍報名。",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (fullError) throw fullError;
    fullId = full.id as string;

    // 「舊比賽」：批次 2 之前建立的資料只有必填欄位（名稱、官方連結、報名截止日），
    // 其餘 Task 1 新增的欄位全是 null——大廳與詳細頁不能壞、不能出現空標題或「null」。
    const { data: minimal, error: minimalError } = await svc
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "舊系統留下的比賽",
        url: "https://example.com/legacy-competition",
        signup_deadline: "2026-11-10T09:00:00.000Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (minimalError) throw minimalError;
    minimalId = minimal.id as string;
  });

  test.afterAll(async () => {
    await resetDb();
    await seedSemester();
  });

  for (const size of SIZES) {
    test(`完整資料的詳細頁 @ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto(`/competitions/${fullId}`);
      await expect(page.getByText("全國資料視覺化競賽")).toBeVisible();
      await expect(page.getByText("已掛上的組別")).toHaveCount(0); // 還沒有組別掛上這場比賽，整區不顯示。

      const overflowsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(overflowsHorizontally).toBe(false);

      await page.screenshot({ path: `.screenshots/round${ROUND}-tpl-t4-detail-full-${size.name}.png`, fullPage: true });
    });

    test(`舊比賽（只有必填欄位）的詳細頁 @ ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await loginAndPassWelcome(page, "a1@g.nccu.edu.tw", /\/my-group$/);
      await page.goto(`/competitions/${minimalId}`);
      await expect(page.getByText("舊系統留下的比賽")).toBeVisible();
      await expect(page.getByText("null")).toHaveCount(0);

      const overflowsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(overflowsHorizontally).toBe(false);

      await page.screenshot({ path: `.screenshots/round${ROUND}-tpl-t4-detail-minimal-${size.name}.png`, fullPage: true });
    });
  }
});
