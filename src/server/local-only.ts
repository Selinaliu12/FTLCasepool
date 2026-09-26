// 只給「本機測試才會用到的危險操作」擋門：清空資料表（resetDb）、用固定密碼直接登入（test-login）。
// 只要 Supabase URL 的 host 不是 127.0.0.1／localhost，一律拒絕，避免不小心對正式站做這些事。
export function assertLocalSupabaseUrl(url: string): void {
  const hostname = new URL(url).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`Refusing to run against non-local Supabase: ${hostname}`);
  }
}
