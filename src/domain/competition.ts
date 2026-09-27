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
};

export type CompetitionFieldErrors = Partial<
  Record<"name" | "url" | "signupDeadline" | "submissionDeadline" | "finalDate", string>
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
