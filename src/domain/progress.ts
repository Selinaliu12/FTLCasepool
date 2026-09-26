import { overdueLabel, type Light } from "./lights";

export type ProgressInput = {
  light: Light | null;
  did: string;
  blocked: string;
  nextSteps: string;
  hasPdf: boolean;
};

export function validateProgress(
  i: ProgressInput
): { ok: true } | { ok: false; errors: Partial<Record<keyof ProgressInput, string>> } {
  const errors: Partial<Record<keyof ProgressInput, string>> = {};

  if (i.light === null) errors.light = "請選燈號";
  if (i.did.trim() === "") errors.did = "請填寫這一句";
  if (i.blocked.trim() === "") errors.blocked = "請填寫這一句";
  if (i.nextSteps.trim() === "") errors.nextSteps = "請填寫這一句";
  if (!i.hasPdf) errors.hasPdf = "請附上 PDF";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true };
}

export function lateBy(deadline: Date, submittedAt: Date): { late: false } | { late: true; hours: number } {
  if (submittedAt.getTime() <= deadline.getTime()) return { late: false };
  const hours = Math.floor((submittedAt.getTime() - deadline.getTime()) / 3_600_000);
  return { late: true, hours };
}

// 已交的期別要標示「準時」或逾期多久（規格 §4.4：截止後仍可補交，系統標記逾期天數）。
// 繳交時間＝最後留下那份 PDF 的上傳時間（pdf_uploaded_at）。晚不到 1 小時時 lateBy 的 hours 是 0，
// 「逾期 0 小時」讀起來像沒逾期，所以另外寫成「逾期不到 1 小時」。
export function submissionTiming(deadline: Date, submittedAt: Date): { late: boolean; label: string } {
  const r = lateBy(deadline, submittedAt);
  if (!r.late) return { late: false, label: "準時" };
  if (r.hours < 1) return { late: true, label: "逾期不到 1 小時" };
  return { late: true, label: overdueLabel(r.hours) };
}

export function validateCheckin(i: { light: Light | null; note: string }): { ok: true } | { ok: false; error: string } {
  if (i.light === null) return { ok: false, error: "請選燈號" };
  if (i.light === "red" && i.note.trim() === "") return { ok: false, error: "紅燈請補一句卡在哪裡" };
  return { ok: true };
}
