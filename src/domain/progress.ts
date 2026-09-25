import type { Light } from "./lights";

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

export function validateCheckin(i: { light: Light | null; note: string }): { ok: true } | { ok: false; error: string } {
  if (i.light === null) return { ok: false, error: "請選燈號" };
  if (i.light === "red" && i.note.trim() === "") return { ok: false, error: "紅燈請補一句卡在哪裡" };
  return { ok: true };
}
