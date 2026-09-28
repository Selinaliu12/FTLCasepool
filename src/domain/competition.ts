// 比賽類型標籤：固定 7 個，可多選，順序依此清單（規格第 15 節 #4）。
export const COMPETITION_TAGS = [
  "企業出題",
  "企劃提案",
  "創業",
  "金融科技",
  "ESG",
  "行銷",
  "數據分析",
] as const;
export type CompetitionTag = (typeof COMPETITION_TAGS)[number];

// 標籤去重並依清單排序（不是錯誤——選重複的標籤只是沒有意義，直接收斂成一份）。
export function normalizeTags(tags: string[]): CompetitionTag[] {
  const set = new Set(tags);
  return COMPETITION_TAGS.filter((t) => set.has(t));
}

// 空白字串一律變 null；有內容的話去頭尾空白後回傳。
export function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

// 假設呼叫端已經先用 validateCompetition 確認過格式（非整數、超出範圍都已經擋掉），這裡只負責
// 把驗證過的字串轉成要存進 DB 的值。
export function toMaxPrizeValue(raw: string): number | null {
  const t = raw.trim();
  return t === "" ? null : Number(t);
}

function unicodeLength(s: string): number {
  return Array.from(s.trim()).length;
}

// 500 字上限的文字欄位，錯誤訊息用欄位名（controller ruling：`{欄位名}最多 500 字`）。
export const LONG_TEXT_FIELD_LABELS = {
  perks: "額外機會",
  signupNote: "報名要交什麼",
  submissionNote: "繳件要交什麼",
  finalNote: "決賽要交什麼",
  finalFormat: "決賽形式與地點",
  fee: "報名費",
  documents: "需準備文件",
  skills: "建議技能",
  staffNote: "幹部備註",
} as const;
type LongTextField = keyof typeof LONG_TEXT_FIELD_LABELS;

export type CompetitionInput = {
  name: string;
  organizer: string;
  theme: string;
  eligibility: string;
  teamSize: string;
  prize: string;
  url: string;
  signupDeadline: Date | null;
  submissionDeadline: Date | null;
  finalDate: Date | null;
  summary: string;
  tags: string[];
  maxPrize: string;
  perks: string;
  infoSessionAt: Date | null;
  signupNote: string;
  submissionNote: string;
  finalNote: string;
  finalFormat: string;
  fee: string;
  documents: string;
  skills: string;
  recommended: boolean;
  staffNote: string;
};

export type CompetitionFieldErrors = Partial<
  Record<
    | "name"
    | "url"
    | "signupDeadline"
    | "submissionDeadline"
    | "finalDate"
    | "summary"
    | "tags"
    | "maxPrize"
    | "infoSessionAt"
    | LongTextField,
    string
  >
>;

// 只接受 http/https：擋掉 javascript: 這類會被瀏覽器執行的協定（見 controller ruling §5）。
function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateCompetition(
  input: CompetitionInput
): { ok: true } | { ok: false; errors: CompetitionFieldErrors } {
  const errors: CompetitionFieldErrors = {};

  if (input.name.trim() === "") errors.name = "請填比賽名稱";
  if (!isHttpUrl(input.url)) errors.url = "請填正確的官方連結";
  if (!input.signupDeadline) errors.signupDeadline = "請填報名截止日";

  if (
    input.signupDeadline &&
    input.submissionDeadline &&
    input.submissionDeadline.getTime() < input.signupDeadline.getTime()
  ) {
    errors.submissionDeadline = "繳件截止日不能早於報名截止日";
  }

  if (
    input.submissionDeadline &&
    input.finalDate &&
    input.finalDate.getTime() < input.submissionDeadline.getTime()
  ) {
    errors.finalDate = "決賽日期不能早於繳件截止日";
  }

  // Final review minor 12：繳件日沒填時，決賽日期直接跟報名截止日比。
  if (
    !input.submissionDeadline &&
    input.signupDeadline &&
    input.finalDate &&
    input.finalDate.getTime() < input.signupDeadline.getTime()
  ) {
    errors.finalDate = "決賽日期不能早於報名截止日";
  }

  if (unicodeLength(input.summary) > 80) errors.summary = "一句話介紹最多 80 字";

  const validTags: readonly string[] = COMPETITION_TAGS;
  if (input.tags.some((t) => !validTags.includes(t))) errors.tags = "比賽類型標籤不合法";

  const trimmedMaxPrize = input.maxPrize.trim();
  if (trimmedMaxPrize !== "" && (!/^\d+$/.test(trimmedMaxPrize) || Number(trimmedMaxPrize) > 100_000_000)) {
    errors.maxPrize = "最高獎金請填整數金額";
  }

  for (const [field, label] of Object.entries(LONG_TEXT_FIELD_LABELS) as [LongTextField, string][]) {
    if (unicodeLength(input[field]) > 500) errors[field] = `${label}最多 500 字`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true };
}

export type CompetitionCard = {
  id: string;
  name: string;
  organizer: string | null;
  theme: string | null;
  eligibility: string | null;
  teamSize: string | null;
  prize: string | null;
  url: string;
  signupDeadline: Date;
  submissionDeadline: Date | null;
  finalDate: Date | null;
  status: "draft" | "published";
  summary: string | null;
  tags: CompetitionTag[];
  maxPrize: number | null;
  perks: string | null;
  infoSessionAt: Date | null;
  signupNote: string | null;
  submissionNote: string | null;
  finalNote: string | null;
  finalFormat: string | null;
  fee: string | null;
  documents: string | null;
  skills: string | null;
  recommended: boolean;
  staffNote: string | null;
};

// 報名截止日由近到遠排在 open；已過報名截止（now 已經超過那一刻）的移到 closed，
// closed 的排序跟 open 相反：最近截止的（signupDeadline 最大、離現在最近）排在最前面。
// 剛好等於截止時刻那一瞬間仍算 open（跟 daysUntil 的「今天截止」一致：截止當天結束前都算未過期）。
export function sortLobby(cards: CompetitionCard[], now: Date): { open: CompetitionCard[]; closed: CompetitionCard[] } {
  const open: CompetitionCard[] = [];
  const closed: CompetitionCard[] = [];

  for (const c of cards) {
    if (c.signupDeadline.getTime() < now.getTime()) closed.push(c);
    else open.push(c);
  }

  open.sort((a, b) => a.signupDeadline.getTime() - b.signupDeadline.getTime());
  closed.sort((a, b) => b.signupDeadline.getTime() - a.signupDeadline.getTime());

  return { open, closed };
}
