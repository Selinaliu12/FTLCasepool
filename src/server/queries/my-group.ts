import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccess } from "@/server/session";
import { createServerSupabase } from "@/server/supabase";
import type { Light, Deliverable } from "@/domain/lights";
import { systemLight, reporterLight, displayLight, periodLabel } from "@/domain/lights";
import { onTimeRate } from "@/domain/on-time";
import { lockedAt } from "@/domain/lock";
import { mapCheckinHistory, type CheckinHistoryEntry } from "@/domain/checkin-history";
import {
  competitionStages,
  competitionLineLight,
  competitionOnTime,
  competitionStatus,
  type Stage,
  type CompetitionStatus,
  type StageSubmissionInput,
} from "@/domain/competition-line";

export type PeriodRow = {
  periodId: string;
  seq: number;
  deadline: Date;
  suggestion: string | null;
  report: null | { submittedAt: Date; submittedBy: string; light: Light; lockedAt: Date };
};

export type MyGroupCompetitionLine = {
  entryId: string;
  lineId: string;
  competitionName: string;
  status: CompetitionStatus;
  stages: Stage[];
  display: { light: Light; source: string };
  onTime: number | null;
};

export type MyGroup = {
  groupName: string;
  projectName: string;
  lineId: string;
  periods: PeriodRow[];
  display: { light: Light; source: string };
  onTime: number | null;
  latestReport: { light: Light; name: string; at: Date } | null;
  checkins: CheckinHistoryEntry[];
  competitionLines: MyGroupCompetitionLine[];
};

// 用 USER-scoped client（createServerSupabase）而不是 service client，讓這裡的每一個
// select 都真的經過 RLS 檢查（groups／lines／periods／progress_reports／line_light_events／
// members 都有各自的 read policy）——這個 query 只該讓使用者看到自己有權限看的東西。
export async function loadMyGroup(): Promise<MyGroup> {
  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || !access.member.groupId) {
    throw new Error("只有專案生能看到自己的組頁");
  }
  const groupId = access.member.groupId;
  const semesterId = access.semesterId;

  const supabase = await createServerSupabase();

  const [groupRes, lineRes, periodsRes, semesterRes, membersRes] = await Promise.all([
    supabase.from("groups").select("name, project_name").eq("id", groupId).single(),
    supabase.from("lines").select("id").eq("group_id", groupId).eq("kind", "project").single(),
    supabase.from("periods").select("id, seq, deadline, suggestion").eq("semester_id", semesterId).order("seq"),
    supabase.from("semesters").select("red_after_hours").eq("id", semesterId).single(),
    supabase.from("members").select("email, name").eq("semester_id", semesterId),
  ]);

  if (groupRes.error) throw groupRes.error;
  if (lineRes.error) throw lineRes.error;
  if (periodsRes.error) throw periodsRes.error;
  if (semesterRes.error) throw semesterRes.error;
  if (membersRes.error) throw membersRes.error;

  const lineId = lineRes.data.id as string;

  const { data: reports, error: reportsError } = await supabase
    .from("progress_reports")
    .select("period_id, light, submitted_by, pdf_uploaded_at")
    .eq("line_id", lineId);
  if (reportsError) throw reportsError;

  const { data: events, error: eventsError } = await supabase
    .from("line_light_events")
    .select("light, at")
    .eq("line_id", lineId);
  if (eventsError) throw eventsError;

  // 「最近回報」：進度報告與中間週點燈號兩種事件裡最新的那一筆，含姓名——line_light_events
  // 只給狀態看板用（不含 who），這裡另外把 checkins 的 created_by 撈出來，跟已經讀到的
  // progress_reports（submitted_by）合併找出最新的一筆。
  const { data: checkins, error: checkinsError } = await supabase
    .from("checkins")
    .select("light, note, created_by, created_at")
    .eq("line_id", lineId)
    .order("created_at", { ascending: false });
  if (checkinsError) throw checkinsError;

  // 顯示送出者「姓名」而不是 email（規格：學生不需要看到組員的帳號）。
  const nameByEmail = new Map((membersRes.data ?? []).map((m) => [m.email as string, m.name as string]));
  const reportByPeriod = new Map((reports ?? []).map((r) => [r.period_id as string, r]));

  const now = new Date();

  const periods: PeriodRow[] = (periodsRes.data ?? []).map((p) => {
    const report = reportByPeriod.get(p.id as string);
    return {
      periodId: p.id as string,
      seq: p.seq as number,
      deadline: new Date(p.deadline as string),
      suggestion: (p.suggestion as string | null) ?? null,
      report: report
        ? {
            submittedAt: new Date(report.pdf_uploaded_at as string),
            submittedBy: nameByEmail.get(report.submitted_by as string) ?? (report.submitted_by as string),
            light: report.light as Light,
            lockedAt: lockedAt(new Date(report.pdf_uploaded_at as string)),
          }
        : null,
    };
  });

  const deliverables: Deliverable[] = periods.map((p) => ({
    label: periodLabel(p.seq),
    deadline: p.deadline,
    submittedAt: p.report?.submittedAt ?? null,
  }));

  const sys = systemLight(deliverables, now, { redAfterHours: semesterRes.data.red_after_hours as number });
  const reporter = reporterLight(
    (events ?? []).map((e) => ({ light: e.light as Light, at: new Date(e.at as string) }))
  );
  const display = displayLight(reporter, sys);
  const onTime = onTimeRate(deliverables, now);

  type ReporterEvent = { light: Light; at: Date; by: string };
  const reportEvents: ReporterEvent[] = (reports ?? []).map((r) => ({
    light: r.light as Light,
    at: new Date(r.pdf_uploaded_at as string),
    by: r.submitted_by as string,
  }));
  const checkinEvents: ReporterEvent[] = (checkins ?? []).map((c) => ({
    light: c.light as Light,
    at: new Date(c.created_at as string),
    by: c.created_by as string,
  }));
  let latestEvent: ReporterEvent | null = null;
  for (const e of [...reportEvents, ...checkinEvents]) {
    if (!latestEvent || e.at.getTime() > latestEvent.at.getTime()) latestEvent = e;
  }
  const latestReport = latestEvent
    ? { light: latestEvent.light, name: nameByEmail.get(latestEvent.by) ?? latestEvent.by, at: latestEvent.at }
    : null;

  const checkinHistory = mapCheckinHistory(
    (checkins ?? []).map((c) => ({
      light: c.light as Light,
      note: c.note as string | null,
      created_by: c.created_by as string,
      created_at: c.created_at as string,
    })),
    nameByEmail
  );

  const competitionLines = await loadCompetitionLinesForGroup(supabase, groupId, semesterRes.data.red_after_hours as number, now);

  return {
    groupName: groupRes.data.name as string,
    projectName: groupRes.data.project_name as string,
    lineId,
    periods,
    display,
    onTime,
    latestReport,
    checkins: checkinHistory,
    competitionLines,
  };
}

// 這組所有已確認的報名（含已退出的——competitionStages／competitionLineLight 對已退出一律
// required=false，會自然算出綠燈、沒有理由，不用另外特殊處理）。用同一個 user-scoped
// client：read_lines／stage_status 的 RLS（can_read_status：is_staff() 或自己組）已經確保
// 這裡只讀得到自己組的線。
export async function loadCompetitionLinesForGroup(
  supabase: SupabaseClient,
  groupId: string,
  redAfterHours: number,
  now: Date
): Promise<MyGroupCompetitionLine[]> {
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

  const entriesById = new Map((entriesRes.data ?? []).map((e) => [e.id as string, e]));
  const stageStatusByLine = new Map<string, { stage: string; version: number; pdf_uploaded_at: string; review_status: string }[]>();
  for (const row of stageStatusRes.data ?? []) {
    const arr = stageStatusByLine.get(row.line_id as string) ?? [];
    arr.push(row);
    stageStatusByLine.set(row.line_id as string, arr);
  }

  return lines.map((line) => {
    const entry = entriesById.get(line.entry_id as string)!;
    const competitionRaw = entry.competitions as unknown as
      | { name: string; signup_deadline: string; submission_deadline: string | null; final_date: string | null }
      | { name: string; signup_deadline: string; submission_deadline: string | null; final_date: string | null }[]
      | null;
    const competition = Array.isArray(competitionRaw) ? competitionRaw[0] : competitionRaw;

    const entryInput = {
      confirmedAt: entry.confirmed_at ? new Date(entry.confirmed_at as string) : null,
      withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at as string) : null,
      result: entry.result as "advanced" | "awarded" | "not_selected" | null,
    };

    const stageSubmissions: StageSubmissionInput[] = (stageStatusByLine.get(line.id as string) ?? []).map((s) => ({
      stage: s.stage as StageSubmissionInput["stage"],
      version: s.version,
      pdfUploadedAt: new Date(s.pdf_uploaded_at),
      reviewStatus: s.review_status as StageSubmissionInput["reviewStatus"],
    }));

    const stages = competitionStages(
      {
        signupDeadline: competition ? new Date(competition.signup_deadline) : null,
        submissionDeadline: competition?.submission_deadline ? new Date(competition.submission_deadline) : null,
        finalDate: competition?.final_date ? new Date(competition.final_date) : null,
      },
      entryInput,
      stageSubmissions,
      now
    );

    const competitionName = competition?.name ?? "";
    const lineLight = competitionLineLight(competitionName, stages, now, { redAfterHours });
    const display = lineLight.light === "green" ? { light: "green" as const, source: "系統：沒有欠交" } : { light: lineLight.light, source: lineLight.reason as string };

    return {
      entryId: line.entry_id as string,
      lineId: line.id as string,
      competitionName,
      status: competitionStatus(stages, entryInput),
      stages,
      display,
      onTime: competitionOnTime(stages, now),
    };
  });
}
