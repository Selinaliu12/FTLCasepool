import { resetDb, seedSemester, ensureLocalStorageBucket } from "../integration/helpers";

export default async function globalSetup() {
  await resetDb();
  await seedSemester();
  // Fix round 1：確保本機 Storage 的 S3 相容桶存在，不依賴 r2.contract.test.ts 剛好先跑過
  // （見 helpers.ts 的 ensureLocalStorageBucket 註解）——否則任何會真的 PUT 檔案到 R2 的
  // E2E 流程（交進度、Task 9 換 PDF）都可能因為桶不存在而失敗。
  await ensureLocalStorageBucket();
}
