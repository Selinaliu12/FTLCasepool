import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// integration 測試需要連到本機 Supabase：從 .env.local 讀取金鑰，不寫死在程式碼裡。
const integrationEnv = loadEnv("", process.cwd(), "");
for (const [key, value] of Object.entries(integrationEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only 在沒有 "react-server" condition 的環境（包含 vitest）預設會直接
      // throw；測試就是要在 node 環境呼叫這些 server 專用模組，改指到一個空模組即可。
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    passWithNoTests: true,
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      { extends: true, test: { name: "component", include: ["src/**/*.test.tsx"], environment: "jsdom" } },
      { extends: true, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 30_000, fileParallelism: false } },
    ],
  },
});
