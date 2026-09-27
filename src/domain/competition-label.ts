import { daysUntil } from "./time";

// 剩餘天數同批次 1 格式（Global Constraints）：剩 N 天／今天截止；已經過了顯示「已截止」
// （用在大廳卡片；sortLobby 已經把過期的卡片分到 closed，這裡只是文字標示）。
export function deadlineLabel(deadline: Date, now: Date): string {
  const d = daysUntil(deadline, now);
  if (d < 0) return "已截止";
  if (d === 0) return "今天截止";
  return `剩 ${d} 天`;
}
