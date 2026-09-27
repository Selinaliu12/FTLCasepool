import { competitionStatus, type Stage, type EntryResult } from "./competition-line";

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

// Final review IMPORTANT 3：報名頁的「報名狀態」。確認報名（建立比賽線）之後，改用比賽線的
// competitionStatus（準備中／已報名／已繳件／晉級／得獎／未入選／已退出）——不然組員填了結果、
// 報名階段也通過了，這裡還是停在「準備中」。確認前沒有比賽線，才用 ENTRY_STATUS_LABEL（未確認）。
export function entryDisplayStatus(entry: {
  lineId: string | null;
  stages: Stage[];
  confirmedAt: Date | null;
  withdrawnAt: Date | null;
  result: EntryResult;
}): string {
  if (entry.lineId === null) {
    return ENTRY_STATUS_LABEL[entryStatus({ confirmedAt: entry.confirmedAt, withdrawnAt: entry.withdrawnAt })];
  }
  return competitionStatus(entry.stages, {
    confirmedAt: entry.confirmedAt,
    withdrawnAt: entry.withdrawnAt,
    result: entry.result,
  });
}
