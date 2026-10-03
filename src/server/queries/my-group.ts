import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase } from "@/server/supabase";
import type { Light, Deliverable } from "@/domain/lights";
import { systemLight, reporterLight, displayLight, periodLabel } from "@/domain/lights";
import { onTimeRate } from "@/domain/on-time";
import { lockedAt } from "@/domain/lock";
import { mapCheckinHistory, type CheckinHistoryEntry } from "@/domain/checkin-history";
import { sortMembersByName, type GroupCardMember } from "@/domain/dashboard";
import { nameByEmailMap } from "@/domain/member-name";
import { loadCompetitionLinesForGroup, type CompetitionLineSummary } from "@/server/queries/competition-lines";
import { loadGroupAssignments, type GroupAssignment } from "@/server/queries/assignments";

export type PeriodRow = {
  periodId: string;
  seq: number;
  deadline: Date;
  suggestion: string | null;
  report: null | { submittedAt: Date; submittedBy: string; light: Light; lockedAt: Date };
};

// fix round 1 #3/#4：型別跟共用查詢模組（competition-lines.ts）保持同一份，不要各自宣告。
export type MyGroupCompetitionLine = CompetitionLineSummary;

export type MyGroup = {
  groupName: string;
  projectName: string | null;
  lineId: string;
  periods: PeriodRow[];
  display: { light: Light; source: string };
  onTime: number | null;
  latestReport: { light: Light; name: string; at: Date } | null;
  checkins: CheckinHistoryEntry[];
  competitionLines: MyGroupCompetitionLine[];
  // 被派到的作業（§17）。
  assignments: GroupAssignment[];
  // Task 4（規格 §14 第 6、7 點）：組別備註（「訂題後的主題」）與這組的組員（姓名、系級，
  // 依姓名排序，不含學號——學號只在管理員頁與 /groups/[id]）。
  note: string | null;
  noteUpdatedBy: string | null;
  noteUpdatedAt: Date | null;
  members: GroupCardMember[];
};

// 用 USER-scoped client（createServerSupabase）而不是 service client，讓這裡的每一個
// select 都真的經過 RLS 檢查（groups／lines／periods／progress_reports／line_light_events／
// members 都有各自的 read policy）——這個 query 只該讓使用者看到自己有權限看的東西。
export async function loadMyGroup(): Promise<MyGroup> {
  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "student" || !access.active.groupId) {
    throw new Error("只有專案生能看到自己的組頁");
  }
  const groupId = access.active.groupId;
  const semesterId = access.semesterId;

  const supabase = await createServerSupabase();

  const [groupRes, lineRes, periodsRes, semesterRes, membersRes, groupMembersRes] = await Promise.all([
    supabase.from("groups").select("name, project_name, note, note_updated_by, note_updated_at").eq("id", groupId).single(),
    supabase.from("lines").select("id").eq("group_id", groupId).eq("kind", "project").single(),
    supabase.from("periods").select("id, seq, deadline, suggestion").eq("semester_id", semesterId).order("seq"),
    supabase.from("semesters").select("red_after_hours").eq("id", semesterId).single(),
    // 紀錄上的名字：含已離開的列（顯示「姓名（已離開）」，Task 7）。
    supabase.from("members").select("email, name, left_at").eq("semester_id", semesterId),
    // 自己組的組員（姓名、系級，不含學號——學號只在管理員頁與 /groups/[id] 顯示）。已離開的人不列。
    supabase.from("members").select("name, dept_year").eq("group_id", groupId).eq("role", "student").is("left_at", null),
  ]);

  if (groupRes.error) throw groupRes.error;
  if (lineRes.error) throw lineRes.error;
  if (periodsRes.error) throw periodsRes.error;
  if (semesterRes.error) throw semesterRes.error;
  if (membersRes.error) throw membersRes.error;
  if (groupMembersRes.error) throw groupMembersRes.error;

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
  const nameByEmail = nameByEmailMap(
    (membersRes.data ?? []).map((m) => ({ email: m.email as string, name: m.name as string, left_at: (m.left_at as string | null) ?? null }))
  );
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

  const assignments = await loadGroupAssignments(supabase, semesterId, groupId, nameByEmail);

  const deliverables: Deliverable[] = [
    ...periods.map((p) => ({
      label: periodLabel(p.seq),
      deadline: p.deadline,
      submittedAt: p.report?.submittedAt ?? null,
    })),
    ...assignments.deliverables,
  ];

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

  const members = sortMembersByName(
    (groupMembersRes.data ?? []).map((m) => ({ name: m.name as string, deptYear: (m.dept_year as string | null) ?? null }))
  );

  return {
    groupName: groupRes.data.name as string,
    projectName: (groupRes.data.project_name as string | null) ?? null,
    lineId,
    periods,
    display,
    onTime,
    latestReport,
    checkins: checkinHistory,
    competitionLines,
    assignments: assignments.list,
    note: (groupRes.data.note as string | null) ?? null,
    noteUpdatedBy: (groupRes.data.note_updated_by as string | null) ?? null,
    noteUpdatedAt: groupRes.data.note_updated_at ? new Date(groupRes.data.note_updated_at as string) : null,
    members,
  };
}
