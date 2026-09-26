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
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    passWithNoTests: true,
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      { extends: true, test: { name: "component", include: ["src/**/*.test.tsx"], environment: "jsdom" } },
      { extends: true, test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", testTimeout: 30_000, fileParallelism: false } },
    ],
  },
});
