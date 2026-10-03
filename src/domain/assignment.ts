import type { Deliverable } from "./lights";

// 專案幹部出的作業（規格 §17）。標題、說明、繳交說明的長度上限跟資料庫的 check 一致。
export const ASSIGNMENT_TITLE_MAX = 100;
export const ASSIGNMENT_TEXT_MAX = 2000;

// 燈號來源與清單上的名字：「作業「市場調查」」，接在「系統：」後面就是「系統：作業「市場調查」逾期 2 天」。
export function assignmentLabel(title: string): string {
  return `作業「${title}」`;
}

export type AssignmentInput = {
  title: string;
  description: string;
  deadline: Date | null;
  groupIds: string[];
};

export function validateAssignment(i: AssignmentInput): { ok: true } | { ok: false; error: string } {
  const title = i.title.trim();
  if (!title) return { ok: false, error: "請填寫標題" };
  if (title.length > ASSIGNMENT_TITLE_MAX) return { ok: false, error: `標題最多 ${ASSIGNMENT_TITLE_MAX} 字` };
  if (i.description.trim().length > ASSIGNMENT_TEXT_MAX) return { ok: false, error: `說明最多 ${ASSIGNMENT_TEXT_MAX} 字` };
  if (!i.deadline) return { ok: false, error: "請填寫截止日期與時間" };
  if (i.groupIds.length === 0) return { ok: false, error: "至少要派給一組" };
  return { ok: true };
}

export function validateSubmissionNote(note: string): { ok: true } | { ok: false; error: string } {
  if (note.trim().length > ASSIGNMENT_TEXT_MAX) return { ok: false, error: `說明最多 ${ASSIGNMENT_TEXT_MAX} 字` };
  return { ok: true };
}

// 作業是專案線的交付項目（§17-6）：跟雙週進度一起算系統判定燈與準時率。
export function assignmentDeliverables(rows: { title: string; deadline: Date; submittedAt: Date | null }[]): Deliverable[] {
  return rows.map((r) => ({ label: assignmentLabel(r.title), deadline: r.deadline, submittedAt: r.submittedAt }));
}

// 刪除作業或取消派組時，需要打字確認的文字（§17-8）。
export function deleteConfirmMessage(count: number): string {
  return `有 ${count} 組已經交了，刪除會一併刪掉這些繳交與檔案`;
}

// update_assignment／delete_assignment 丟出的 'needs_confirm:N' → N；其他錯誤回 null。
export function parseNeedsConfirm(message: string): number | null {
  const m = /needs_confirm:(\d+)/.exec(message);
  return m ? Number(m[1]) : null;
}
