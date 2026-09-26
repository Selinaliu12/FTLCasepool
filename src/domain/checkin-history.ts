import type { Light } from "./lights";

// 中間週燈號歷程：/groups/[groupId]（group-detail.ts）與 /my-group（my-group.ts）
// 兩個查詢原本各自重複同一段「checkins 原始列 → 顯示用姓名／Date」的映射邏輯，抽成共用的
// 型別與函式，兩邊改成呼叫這裡。
export type CheckinHistoryEntry = { light: Light; note: string | null; by: string; at: Date };

export type CheckinHistoryRow = {
  light: Light;
  note: string | null;
  created_by: string;
  created_at: string;
};

// 顯示送出者「姓名」而不是 email；找不到姓名（理論上不會發生，防禦性）就退回 email 本身。
export function mapCheckinHistory(rows: CheckinHistoryRow[], nameByEmail: Map<string, string>): CheckinHistoryEntry[] {
  return rows.map((c) => ({
    light: c.light,
    note: c.note,
    by: nameByEmail.get(c.created_by) ?? c.created_by,
    at: new Date(c.created_at),
  }));
}
