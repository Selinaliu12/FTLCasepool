// 只給「本機測試才會用到的危險操作」擋門：清空資料表（resetDb）、用固定密碼直接登入（test-login）。
// 只要 Supabase URL 的 host 不是 127.0.0.1／localhost，一律拒絕，避免不小心對正式站做這些事。
export function isLocalSupabaseUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function assertLocalSupabaseUrl(url: string): void {
  if (!isLocalSupabaseUrl(url)) {
    let hostname = url;
    try {
      hostname = new URL(url).hostname;
    } catch {
      // 壞掉的網址：直接把原字串放進錯誤訊息。
    }
    throw new Error(`Refusing to run against non-local Supabase: ${hostname}`);
  }
}
