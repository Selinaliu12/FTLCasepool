import { isLocked } from "./lock";
import { systemLight, type Deliverable, type SystemLight, type Light } from "./lights";
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

// 一條比賽線「結束」＝已退出，或結果已經是未入選／得獎（不會再有新的必要階段）。結束的線
// 沒有系統判定燈（controller ruling，fix round 1）：與「目前沒有任何欠交、燈是綠色」是兩回事，
// UI 要用 null 顯示成果徽章（已退出／得獎／未入選），不是綠燈。
export function isLineEnded(entry: EntryInput): boolean {
  return entry.withdrawnAt !== null || isFinalResult(entry.result);
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

    // firstSubmittedAt＝這個階段所有版本裡最早的上傳時間（fix round 1 #1）：不能假設
    // version 遞增等於時間遞增（version 只是審核順序），用 Math.min 直接比時間比較保險。
    const firstSubmittedAt =
      stageSubs.length > 0 ? new Date(Math.min(...stageSubs.map((s) => s.pdfUploadedAt.getTime()))) : null;
    const latestSub = stageSubs.length > 0 ? stageSubs[stageSubs.length - 1] : null;
    const latest = latestSub
      ? { version: latestSub.version, status: latestSub.reviewStatus, locked: isLocked(latestSub.pdfUploadedAt, now) }
      : null;

    // 完成日＝最後通過那一版的送出時間；approved 版本一出現就是那個階段的終點，理論上不會
    // 再有更新的版本，用 version 最大的一筆 approved 版本比較保險（不假設陣列順序）。
    const approvedSubs = stageSubs.filter((s) => s.reviewStatus === "approved");
    const completedAt =
      approvedSubs.length > 0 ? approvedSubs[approvedSubs.length - 1].pdfUploadedAt : null;

    // fix round 1：一旦結果是未入選／得獎，三個階段全部不再 required（不管有沒有交過）——
    // 「已結束」的線不會再累積新的必要階段，跟「還沒結束但這階段還沒交」不是同一件事。
    const required = deadline !== null && entry.confirmedAt !== null && entry.withdrawnAt === null && !isFinalResult(entry.result);

    return { key, label: STAGE_LABEL[key], deadline, required, firstSubmittedAt, latest, completedAt };
  });
}

// 系統判定燈：沿用 lights.ts 的 systemLight，只把「必要且有截止日」的階段轉成 Deliverable。
// 被退回但沒有更新版本（latest.status === 'returned'）一律黃燈，跟逾期規則互斥（systemLight
// 內部看 d.returned 就會直接判黃，不會再看截止日）。
//
// fix round 1：已結束的線（已退出／未入選／得獎）回傳 null——不是「綠燈、沒有理由」，是
// 「根本不判燈」，UI 要改顯示成果徽章。呼叫端（competitionLineDisplay／UI）用 null 判斷
// 要不要畫 LightBadge。
export function competitionLineLight(
  competitionName: string,
  stages: Stage[],
  entry: EntryInput,
  now: Date,
  s: { redAfterHours: number }
): SystemLight | null {
  if (isLineEnded(entry)) return null;

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

export type CompetitionLineDisplay = { light: Light | null; source: string | null };

// fix round 1 #2：「系統：沒有欠交」這句話原本在 dashboard.ts／my-group.ts 各自重複一份，
// 統一收在這裡——competitionLineLight 回傳綠燈時補上這句固定文字；回傳 null（已結束）時
// source 也是 null，UI 不畫 LightBadge，改畫成果徽章。
export function competitionLineDisplay(
  competitionName: string,
  stages: Stage[],
  entry: EntryInput,
  now: Date,
  s: { redAfterHours: number }
): CompetitionLineDisplay {
  const light = competitionLineLight(competitionName, stages, entry, now, s);
  if (light === null) return { light: null, source: null };
  if (light.light === "green") return { light: "green", source: "系統：沒有欠交" };
  return { light: light.light, source: light.reason as string };
}

// 只看每個必要階段「第一次送出的時間」跟目前的截止日；退回重交不影響已經記錄的
// firstSubmittedAt，也因此不影響準時率。
//
// fix round 1：這裡故意不能直接沿用 stage.required——一旦結果是未入選／得獎，required 全部
// 變成 false（見 competitionStages），但準時率仍要算進「結束前已經送出、而且截止日已過」的
// 階段（不能因為比賽結束就把歷史準時記錄洗掉）；還沒送出、已經沒必要再交的階段（例如未入選
// 之後的決賽）則不算進分母，不會因為比賽結束被扣分。
export function competitionOnTime(stages: Stage[], entry: EntryInput, now: Date): number | null {
  const ended = isFinalResult(entry.result);

  const deliverables: Deliverable[] = stages
    .filter((stage): stage is Stage & { deadline: Date } => {
      if (stage.deadline === null || entry.confirmedAt === null || entry.withdrawnAt !== null) return false;
      if (ended) return stage.firstSubmittedAt !== null;
      return true;
    })
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
