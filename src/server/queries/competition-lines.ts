import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Light } from "@/domain/lights";
import { isLocked } from "@/domain/lock";
import {
  competitionStages,
  competitionLineDisplay,
  competitionOnTime,
  competitionStatus,
  type Stage,
  type CompetitionStatus,
  type StageKey,
  type ReviewStatus,
  type StageSubmissionInput,
  type EntryInput,
} from "@/domain/competition-line";

// 每一版的完整明細（含 id、評語）——給 group-detail 頁的審核 UI／學生看每一版評語用。跟
// stage_status 視圖（只有狀態欄位，給其他幹部算燈號）分開；這裡直接讀 stage_submissions 本表，
// 只能在已經確認「呼叫者看得到內容」的情境（PM／自己組／管理員）使用。
export type StageSubmissionDetail = {
  id: string;
  stage: StageKey;
  version: number;
  reviewStatus: ReviewStatus;
  pdfUploadedAt: Date;
  locked: boolean;
  comment: string | null;
};

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
  submissions: StageSubmissionDetail[];
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
  submissionDetails?: StageSubmissionDetail[];
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
    submissions: input.submissionDetails ?? [],
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

  // stage_status（狀態視圖，只有狀態欄位）算 Stage［截止日、locked、completedAt］用；
  // stage_submissions（本表，含 id／comment，read policy 是 can_read_content——只有 PM／
  // 自己組／管理員讀得到）給審核 UI 與學生看每一版評語用。兩邊都查一次，欄位用途不重疊。
  const [entriesRes, stageStatusRes, submissionsRes] = await Promise.all([
    supabase
      .from("competition_entries")
      .select("id, confirmed_at, withdrawn_at, result, competitions(name, signup_deadline, submission_deadline, final_date)")
      .in("id", entryIds),
    supabase.from("stage_status").select("line_id, stage, version, pdf_uploaded_at, review_status").in("line_id", lineIds),
    supabase
      .from("stage_submissions")
      .select("id, line_id, stage, version, pdf_uploaded_at, review_status, comment")
      .in("line_id", lineIds),
  ]);
  if (entriesRes.error) throw entriesRes.error;
  if (stageStatusRes.error) throw stageStatusRes.error;
  if (submissionsRes.error) throw submissionsRes.error;

  const entriesById = new Map(((entriesRes.data ?? []) as EntryRow[]).map((e) => [e.id, e]));
  const stageStatusByLine = new Map<string, StageStatusRow[]>();
  for (const row of (stageStatusRes.data ?? []) as StageStatusRow[]) {
    const arr = stageStatusByLine.get(row.line_id) ?? [];
    arr.push(row);
    stageStatusByLine.set(row.line_id, arr);
  }

  type SubmissionRow = { id: string; line_id: string; stage: string; version: number; pdf_uploaded_at: string; review_status: string; comment: string | null };
  const submissionsByLine = new Map<string, SubmissionRow[]>();
  for (const row of (submissionsRes.data ?? []) as SubmissionRow[]) {
    const arr = submissionsByLine.get(row.line_id) ?? [];
    arr.push(row);
    submissionsByLine.set(row.line_id, arr);
  }

  const summaries: CompetitionLineSummary[] = [];
  for (const line of lines) {
    // Final review IMPORTANT 1b：報名或比賽那一列讀不到（RLS 擋掉、資料不一致）時整條跳過，
    // 絕對不捏造截止日（以前用 new Date(0) 當報名截止日，會變成紅燈「報名逾期 2xxxx 天」）。
    // /my-group 的報名清單會把這筆報名顯示成「比賽資料無法讀取」，不畫燈。
    const entry = entriesById.get(line.entry_id as string);
    if (!entry) continue;
    const competitionRaw = entry.competitions;
    const competition = Array.isArray(competitionRaw) ? competitionRaw[0] : competitionRaw;
    if (!competition) continue;

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

    summaries.push(summarizeCompetitionLine({
      lineId: line.id as string,
      entryId: line.entry_id as string,
      competition: {
        name: competition.name,
        signupDeadline: new Date(competition.signup_deadline),
        submissionDeadline: competition.submission_deadline ? new Date(competition.submission_deadline) : null,
        finalDate: competition.final_date ? new Date(competition.final_date) : null,
      },
      entry: entryInput,
      submissions: stageSubmissions,
      now,
      redAfterHours,
      submissionDetails: (submissionsByLine.get(line.id as string) ?? [])
        .map((s) => ({
          id: s.id,
          stage: s.stage as StageKey,
          version: s.version,
          reviewStatus: s.review_status as ReviewStatus,
          pdfUploadedAt: new Date(s.pdf_uploaded_at),
          locked: isLocked(new Date(s.pdf_uploaded_at), now),
          comment: s.comment,
        }))
        .sort((a, b) => a.version - b.version),
    }));
  }
  return summaries;
}
