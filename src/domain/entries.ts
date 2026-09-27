// 報名狀態：未確認（掛上去但還沒確認報名）／準備中（確認報名後，Task 4 的階段判燈之前都是這個
// 狀態）／已退出。晉級／得獎／未入選是組員手動填的結果（Task 4 範圍），這裡先不處理。
export type EntryStatus = "unconfirmed" | "in_progress" | "withdrawn";

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  unconfirmed: "未確認",
  in_progress: "準備中",
  withdrawn: "已退出",
};

export function entryStatus(entry: { confirmedAt: Date | null; withdrawnAt: Date | null }): EntryStatus {
  if (entry.withdrawnAt) return "withdrawn";
  if (entry.confirmedAt) return "in_progress";
  return "unconfirmed";
}
