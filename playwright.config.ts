import { defineConfig } from "@playwright/test";

// globalSetup（呼叫本機 Supabase 的服務身分）在 Playwright 自己的 Node 行程裡跑，
// 不會像 `next dev` 一樣自動讀 .env.local，所以這裡手動載入一次。
try {
  process.loadEnvFile(".env.local");
} catch {
  // 本機沒有 .env.local 時（例如尚未設定），讓後續步驟用既有的環境變數，錯誤訊息會更清楚。
}

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // 所有 e2e 測試共用同一個本機 Supabase；admin.spec.ts 會呼叫 resetDb() 重建資料庫，
  // 如果跟其他測試平行跑，會把別的測試正在依賴的種子資料洗掉（曾經因此讓 access.spec.ts
  // 隨機失敗）。固定用一個 worker，全部測試依序執行，不追求平行速度。
  workers: 1,
  use: { baseURL: "http://localhost:3000", timezoneId: "Asia/Taipei", locale: "zh-TW", trace: "retain-on-failure", video: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    env: {
      ENABLE_TEST_LOGIN: "true",
    },
  },
});
