import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Light } from "@/domain/lights";
import {
  competitionStages,
  competitionLineDisplay,
  competitionOnTime,
  competitionStatus,
  type Stage,
  type CompetitionStatus,
  type StageSubmissionInput,
  type EntryInput,
} from "@/domain/competition-line";

// 一條比賽線的摘要：dashboard 組卡與 /my-group／group-detail 都要，欄位是兩邊的聯集——
// dashboard 只用 lineId／competitionName／light／source／onTime，my-group／group-detail
// 還要 entryId（連到報名頁）、status、stages（三個階段的截止日／繳交狀態）。
export type CompetitionLineSummary = {
  entryId: string;
  lineId: string;
  competitionName: string;
  status: CompetitionStatus;
  stages: Stage[];
  light: Light | null;
  source: string | null;
  onTime: number | null;
};

// fix round 1 #3/#4：把 competitionStages／competitionLineDisplay／competitionStatus／
// competitionOnTime 這四個純函式兜起來的邏輯抽成一個共用的「rows → summary」映射，
// dashboard.ts（批次查多組）與 loadCompetitionLinesForGroup（查單一組）都呼叫這個函式，
// 不要各自重複一份幾乎一樣的程式碼。
export function summarizeCompetitionLine(input: {
  lineId: string;
  entryId: string;
  competition: { name: string; signupDeadline: Date; submissionDeadline: Date | null; finalDate: Date | null };
  entry: EntryInput;
  submissions: StageSubmissionInput[];
  now: Date;
  redAfterHours: number;
}): CompetitionLineSummary {
  const stages = competitionStages(
    {
      signupDeadline: input.competition.signupDeadline,
      submissionDeadline: input.competition.submissionDeadline,
      finalDate: input.competition.finalDate,
    },
    input.entry,
    input.submissions,
    input.now
  );

  const display = competitionLineDisplay(input.competition.name, stages, input.entry, input.now, {
    redAfterHours: input.redAfterHours,
  });

  return {
    entryId: input.entryId,
    lineId: input.lineId,
    competitionName: input.competition.name,
    status: competitionStatus(stages, input.entry),
    stages,
    light: display.light,
    source: display.source,
    onTime: competitionOnTime(stages, input.entry, input.now),
  };
}

type StageStatusRow = { line_id: string; stage: string; version: number; pdf_uploaded_at: string; review_status: string };
type CompetitionRow = { name: string; signup_deadline: string; submission_deadline: string | null; final_date: string | null };
type EntryRow = {
  id: string;
  confirmed_at: string | null;
  withdrawn_at: string | null;
  result: string | null;
  competitions: CompetitionRow | CompetitionRow[] | null;
};

// 這組所有已確認的報名（含已退出的——summarizeCompetitionLine／competitionLineDisplay 對
// 已退出、未入選、得獎一律回傳 light=null，UI 自己決定要不要顯示成果徽章，不用在這裡
// 特殊處理）。用同一個 user-scoped client：read_lines／stage_status 的 RLS
// （can_read_status：is_staff() 或自己組）已經確保這裡只讀得到自己組的線。
export async function loadCompetitionLinesForGroup(
  supabase: SupabaseClient,
  groupId: string,
  redAfterHours: number,
  now: Date
): Promise<CompetitionLineSummary[]> {
  const { data: lines, error: linesError } = await supabase
    .from("lines")
    .select("id, entry_id")
    .eq("group_id", groupId)
    .eq("kind", "competition");
  if (linesError) throw linesError;
  if (!lines || lines.length === 0) return [];

  const entryIds = lines.map((l) => l.entry_id as string);
  const lineIds = lines.map((l) => l.id as string);

  const [entriesRes, stageStatusRes] = await Promise.all([
    supabase
      .from("competition_entries")
      .select("id, confirmed_at, withdrawn_at, result, competitions(name, signup_deadline, submission_deadline, final_date)")
      .in("id", entryIds),
    supabase.from("stage_status").select("line_id, stage, version, pdf_uploaded_at, review_status").in("line_id", lineIds),
  ]);
  if (entriesRes.error) throw entriesRes.error;
  if (stageStatusRes.error) throw stageStatusRes.error;

  const entriesById = new Map(((entriesRes.data ?? []) as EntryRow[]).map((e) => [e.id, e]));
  const stageStatusByLine = new Map<string, StageStatusRow[]>();
  for (const row of (stageStatusRes.data ?? []) as StageStatusRow[]) {
    const arr = stageStatusByLine.get(row.line_id) ?? [];
    arr.push(row);
    stageStatusByLine.set(row.line_id, arr);
  }

  return lines.map((line) => {
    const entry = entriesById.get(line.entry_id as string)!;
    const competitionRaw = entry.competitions;
    const competition = Array.isArray(competitionRaw) ? competitionRaw[0] : competitionRaw;

    const entryInput: EntryInput = {
      confirmedAt: entry.confirmed_at ? new Date(entry.confirmed_at) : null,
      withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at) : null,
      result: entry.result as EntryInput["result"],
    };

    const stageSubmissions: StageSubmissionInput[] = (stageStatusByLine.get(line.id as string) ?? []).map((s) => ({
      stage: s.stage as StageSubmissionInput["stage"],
      version: s.version,
      pdfUploadedAt: new Date(s.pdf_uploaded_at),
      reviewStatus: s.review_status as StageSubmissionInput["reviewStatus"],
    }));

    return summarizeCompetitionLine({
      lineId: line.id as string,
      entryId: line.entry_id as string,
      competition: {
        name: competition?.name ?? "",
        signupDeadline: competition ? new Date(competition.signup_deadline) : new Date(0),
        submissionDeadline: competition?.submission_deadline ? new Date(competition.submission_deadline) : null,
        finalDate: competition?.final_date ? new Date(competition.final_date) : null,
      },
      entry: entryInput,
      submissions: stageSubmissions,
      now,
      redAfterHours,
    });
  });
}
