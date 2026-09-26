import { daysUntil } from "@/domain/time";

// 「剩幾天」只在還沒逾期的期別顯示，包一層 daysUntil()（用台北日期比對，不是單純除以
// 86400000）而不是自己重算 Math.ceil((deadline-now)/一天)，理由：daysUntil 已經處理過
// 「凌晨、跨日」這種邊界，兩邊各自算會不一致。
// n === 0 ? 0 : n 順便把可能出現的 -0（-0 === 0 在 JS 是 true，所以直接回傳字面量 0）
// 正規化掉，避免畫面上出現「剩 -0 天」這種東西。
export function daysLeft(deadline: Date, now: Date): number {
  const n = daysUntil(deadline, now);
  return n === 0 ? 0 : n;
}
