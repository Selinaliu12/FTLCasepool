import { isLocalSupabaseUrl } from "./local-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}
export const env = {
  get supabaseUrl() { return required("NEXT_PUBLIC_SUPABASE_URL"); },
  get supabaseAnonKey() { return required("NEXT_PUBLIC_SUPABASE_ANON_KEY"); },
  get supabaseServiceKey() { return required("SUPABASE_SERVICE_ROLE_KEY"); },
  get adminEmails() { return process.env.ADMIN_EMAILS ?? ""; },
  // 本機測試登入（固定密碼、email provider）只在三個條件都成立時開放：明確設了 ENABLE_TEST_LOGIN、
  // 不在 Vercel 上、而且連的是本機 Supabase（跟 local-only.ts 的判斷一致）。
  get enableTestLogin() {
    return (
      process.env.ENABLE_TEST_LOGIN === "true" &&
      process.env.VERCEL !== "1" &&
      isLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    );
  },
  get r2() {
    return {
      accountId: required("R2_ACCOUNT_ID"),
      accessKeyId: required("R2_ACCESS_KEY_ID"),
      secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
      bucket: required("R2_BUCKET"),
      // 本機測試指向本機 Supabase Storage 的 S3 相容端點；正式環境沒有這個變數，
      // r2.ts 會退回真正的 R2 端點（https://{accountId}.r2.cloudflarestorage.com）。
      endpoint: process.env.R2_ENDPOINT,
      region: process.env.R2_REGION ?? "auto",
    };
  },
};
