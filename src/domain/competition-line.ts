import { isLocked } from "./lock";
import { systemLight, type Deliverable, type SystemLight } from "./lights";
import { onTimeRate } from "./on-time";

export type StageKey = "signup" | "submission" | "final";
export type StageLabel = "報名" | "繳件" | "決賽";

export const STAGE_KEYS: StageKey[] = ["signup", "submission", "final"];

export const STAGE_LABEL: Record<StageKey, StageLabel> = {
  signup: "報名",
  submission: "繳件",
  final: "決賽",
};

export type ReviewStatus = "pending" | "approved" | "returned";

export type EntryResult = "advanced" | "awarded" | "not_selected" | null;

export type StageSubmissionInput = {
  stage: StageKey;
  version: number;
  pdfUploadedAt: Date;
  reviewStatus: ReviewStatus;
};

export type CompetitionDeadlines = {
  signupDeadline: Date | null;
  submissionDeadline: Date | null;
  finalDate: Date | null;
};

export type EntryInput = {
  confirmedAt: Date | null;
  withdrawnAt: Date | null;
  result: EntryResult;
};

export type Stage = {
  key: StageKey;
  label: StageLabel;
  deadline: Date | null;
  required: boolean;
  firstSubmittedAt: Date | null;
  latest: { version: number; status: ReviewStatus; locked: boolean } | null;
  completedAt: Date | null;
};

export type CompetitionStatus = "準備中" | "已報名" | "已繳件" | "晉級" | "得獎" | "未入選" | "已退出";

const STAGE_DEADLINE_KEY: Record<StageKey, keyof CompetitionDeadlines> = {
  signup: "signupDeadline",
  submission: "submissionDeadline",
  final: "finalDate",
};

function isFinalResult(result: EntryResult): boolean {
  return result === "not_selected" || result === "awarded";
}

// 三個階段的截止日、繳交狀態、要不要判燈——純函式，deadline 一律從傳入的 comp 目前值算，
// 不記錄「當初」的截止日，所以幹部改早截止日之後，這裡自然就用新的（Review Focus 1）。
export function competitionStages(
  comp: CompetitionDeadlines,
  entry: EntryInput,
  submissions: StageSubmissionInput[],
  now: Date
): Stage[] {
  return STAGE_KEYS.map((key) => {
    const deadline = comp[STAGE_DEADLINE_KEY[key]];
    const stageSubs = submissions.filter((s) => s.stage === key).sort((a, b) => a.version - b.version);

    const firstSubmittedAt = stageSubs.length > 0 ? stageSubs[0].pdfUploadedAt : null;
    const latestSub = stageSubs.length > 0 ? stageSubs[stageSubs.length - 1] : null;
    const latest = latestSub
      ? { version: latestSub.version, status: latestSub.reviewStatus, locked: isLocked(latestSub.pdfUploadedAt, now) }
      : null;

    // 完成日＝最後通過那一版的送出時間；approved 版本一出現就是那個階段的終點，理論上不會
    // 再有更新的版本，用 version 最大的一筆 approved 版本比較保險（不假設陣列順序）。
    const approvedSubs = stageSubs.filter((s) => s.reviewStatus === "approved");
    const completedAt =
      approvedSubs.length > 0 ? approvedSubs[approvedSubs.length - 1].pdfUploadedAt : null;

    const notYetSubmitted = firstSubmittedAt === null;
    const required =
      deadline !== null &&
      entry.confirmedAt !== null &&
      entry.withdrawnAt === null &&
      !(isFinalResult(entry.result) && notYetSubmitted);

    return { key, label: STAGE_LABEL[key], deadline, required, firstSubmittedAt, latest, completedAt };
  });
}

// 系統判定燈：沿用 lights.ts 的 systemLight，只把「必要且有截止日」的階段轉成 Deliverable。
// 被退回但沒有更新版本（latest.status === 'returned'）一律黃燈，跟逾期規則互斥（systemLight
// 內部看 d.returned 就會直接判黃，不會再看截止日）。
export function competitionLineLight(
  competitionName: string,
  stages: Stage[],
  now: Date,
  s: { redAfterHours: number }
): SystemLight {
  const deliverables: Deliverable[] = stages
    .filter((stage): stage is Stage & { deadline: Date } => stage.required && stage.deadline !== null)
    .map((stage) => ({
      label: `${competitionName} ${stage.label}`,
      deadline: stage.deadline,
      submittedAt: stage.firstSubmittedAt,
      returned: stage.latest?.status === "returned",
    }));

  return systemLight(deliverables, now, s);
}

// 只看每個必要階段「第一次送出的時間」跟目前的截止日；退回重交不影響已經記錄的
// firstSubmittedAt，也因此不影響準時率。
export function competitionOnTime(stages: Stage[], now: Date): number | null {
  const deliverables: Deliverable[] = stages
    .filter((stage): stage is Stage & { deadline: Date } => stage.required && stage.deadline !== null)
    .map((stage) => ({
      label: stage.label,
      deadline: stage.deadline,
      submittedAt: stage.firstSubmittedAt,
    }));

  return onTimeRate(deliverables, now);
}

export function competitionStatus(stages: Stage[], entry: EntryInput): CompetitionStatus {
  if (entry.withdrawnAt) return "已退出";
  if (entry.result === "awarded") return "得獎";
  if (entry.result === "not_selected") return "未入選";
  if (entry.result === "advanced") return "晉級";

  const submission = stages.find((s) => s.key === "submission");
  const signup = stages.find((s) => s.key === "signup");

  if (submission?.completedAt) return "已繳件";
  if (signup?.completedAt) return "已報名";
  return "準備中";
}
