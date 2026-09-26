import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase } from "@/server/supabase";
import type { Light, Deliverable } from "@/domain/lights";
import { systemLight, reporterLight, displayLight } from "@/domain/lights";
import { onTimeRate } from "@/domain/on-time";
import { lockedAt } from "@/domain/lock";

export type PeriodRow = {
  periodId: string;
  seq: number;
  deadline: Date;
  report: null | { submittedAt: Date; submittedBy: string; light: Light; lockedAt: Date };
};

export type MyGroup = {
  groupName: string;
  projectName: string;
  lineId: string;
  periods: PeriodRow[];
  display: { light: Light; source: string };
  onTime: number | null;
  latestReport: { light: Light; name: string; at: Date } | null;
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
    supabase.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq"),
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
    .select("light, created_by, created_at")
    .eq("line_id", lineId);
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
    label: `第${p.seq}期`,
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

  return {
    groupName: groupRes.data.name as string,
    projectName: groupRes.data.project_name as string,
    lineId,
    periods,
    display,
    onTime,
    latestReport,
  };
}
