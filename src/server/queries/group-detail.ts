import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import type { Light, Deliverable } from "@/domain/lights";
import { systemLight, reporterLight, displayLight, periodLabel } from "@/domain/lights";
import { onTimeRate } from "@/domain/on-time";
import { submissionTiming } from "@/domain/progress";
import { mapCheckinHistory, type CheckinHistoryEntry } from "@/domain/checkin-history";
import { isUuid } from "@/domain/id";
import { loadCompetitionLinesForGroup, type CompetitionLineSummary } from "@/server/queries/competition-lines";

export type GroupDetailPeriod = {
  seq: number;
  deadline: Date;
  report:
    | null
    | {
        reportId: string;
        light: Light;
        did: string;
        blocked: string;
        nextSteps: string;
        submittedBy: string;
        submittedAt: Date;
        timing: { late: boolean; label: string };
      };
};

export type GroupDetail = {
  group: { id: string; name: string; projectName: string };
  display: { light: Light; source: string };
  onTime: number | null;
  periods: GroupDetailPeriod[];
  checkins: CheckinHistoryEntry[];
  competitionLines: CompetitionLineSummary[];
};

// 規格第 3 節「看進度內容（三句話、PDF、紅燈說明）」：管理員 ✓、專案幹部 ✓（看得到所有組）、
// 其他幹部 ✗、專案生只看自己組。專案幹部與學生走使用者身分連線，讓 RLS（can_read_content：
// is_pm() 或自己組）真的決定看不看得到；其他幹部即使 RLS 本身沒擋 groups 這張表
// （read_groups 對 is_staff() 一律放行），也要在這裡明確擋下來，不能只靠 progress_reports／
// checkins 的 RLS——否則其他幹部還是讀得到組名、期別這些非內容欄位。管理員通常沒有 member
// 列（信箱只出現在 ADMIN_EMAILS，不在名單匯入範圍），這種情況才退回服務身分，一樣只選
// 這裡真正要用到的欄位。
export async function loadGroupDetail(groupId: string): Promise<GroupDetail | null> {
  // 亂填的 id（不是 UUID 格式）打到 PostgREST 的 eq() 會丟 22P02，不是「查無此列」；
  // 在打資料庫前就先擋下來，回傳跟其他沒有權限情況一樣的 null（頁面轉成 404），不要讓
  // 這種輸入變成未處理的例外。
  if (!isUuid(groupId)) return null;

  const access = await getAccess();
  if (access.kind !== "ok") return null;

  // Controller ruling（Task 14 fix round 1）：規格第 3 節「看進度內容」管理員 ✓，不管
  // 管理員在名單上有沒有 member 列、那筆 member 是什麼角色（只要不是學生）——管理員身分本身
  // 就該看得到全部內容。改之前的寫法（isAdmin && !member）會讓「同時是管理員又被匯入成
  // 其他幹部」的人被下面的 officer 分支擋下來，跟權限表衝突。學生即使同時掛 isAdmin，也走
  // 學生自己的分支（只看自己組），不因為 isAdmin 而升級成看得到全部組。
  const useService = access.isAdmin && access.member?.role !== "student";
  if (!useService) {
    const role = access.member?.role;
    if (role === "student" && access.member?.groupId !== groupId) return null;
    // catch-all：只有 pm／student 能走到這裡繼續往下查；officer（以及理論上不會出現的其他
    // 角色）在這裡就被擋掉，不用再特別為 officer 寫一行——這行本來就涵蓋它。
    if (role !== "pm" && role !== "student") return null;
  }

  const db = useService ? createServiceSupabase() : await createServerSupabase();
  const semesterId = access.semesterId;

  const [groupRes, lineRes, periodsRes, semesterRes, membersRes] = await Promise.all([
    db.from("groups").select("id, name, project_name").eq("id", groupId).eq("semester_id", semesterId).maybeSingle(),
    db.from("lines").select("id").eq("group_id", groupId).eq("kind", "project").maybeSingle(),
    db.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq"),
    db.from("semesters").select("red_after_hours").eq("id", semesterId).single(),
    db.from("members").select("email, name").eq("semester_id", semesterId),
  ]);

  if (groupRes.error) throw groupRes.error;
  if (lineRes.error) throw lineRes.error;
  if (periodsRes.error) throw periodsRes.error;
  if (semesterRes.error) throw semesterRes.error;
  if (membersRes.error) throw membersRes.error;

  // 其他幹部、別組學生在 !useService 分支已經被擋掉；這裡的 null 涵蓋「groupId 亂填」或
  // RLS 擋下（理論上不會發生在通過上面檢查的角色，屬於防禦性檢查）兩種情況。
  if (!groupRes.data || !lineRes.data) return null;

  const lineId = lineRes.data.id as string;

  const [reportsRes, checkinsRes] = await Promise.all([
    db
      .from("progress_reports")
      .select("id, period_id, light, did, blocked, next_steps, submitted_by, pdf_uploaded_at")
      .eq("line_id", lineId),
    db.from("checkins").select("light, note, created_by, created_at").eq("line_id", lineId).order("created_at", { ascending: false }),
  ]);
  if (reportsRes.error) throw reportsRes.error;
  if (checkinsRes.error) throw checkinsRes.error;

  const nameByEmail = new Map((membersRes.data ?? []).map((m) => [m.email as string, m.name as string]));
  const reportByPeriod = new Map((reportsRes.data ?? []).map((r) => [r.period_id as string, r]));

  const periods: GroupDetailPeriod[] = (periodsRes.data ?? []).map((p) => {
    const report = reportByPeriod.get(p.id as string);
    const deadline = new Date(p.deadline as string);
    if (!report) return { seq: p.seq as number, deadline, report: null };
    const submittedAt = new Date(report.pdf_uploaded_at as string);
    return {
      seq: p.seq as number,
      deadline,
      report: {
        reportId: report.id as string,
        light: report.light as Light,
        did: report.did as string,
        blocked: report.blocked as string,
        nextSteps: report.next_steps as string,
        submittedBy: nameByEmail.get(report.submitted_by as string) ?? (report.submitted_by as string),
        submittedAt,
        timing: submissionTiming(deadline, submittedAt),
      },
    };
  });

  const deliverables: Deliverable[] = periods.map((p) => ({
    label: periodLabel(p.seq),
    deadline: p.deadline,
    submittedAt: p.report?.submittedAt ?? null,
  }));

  const now = new Date();
  const sys = systemLight(deliverables, now, { redAfterHours: semesterRes.data.red_after_hours as number });

  type Ev = { light: Light; at: Date };
  const reportEvents: Ev[] = (reportsRes.data ?? []).map((r) => ({
    light: r.light as Light,
    at: new Date(r.pdf_uploaded_at as string),
  }));
  const checkinEvents: Ev[] = (checkinsRes.data ?? []).map((c) => ({
    light: c.light as Light,
    at: new Date(c.created_at as string),
  }));
  const reporter = reporterLight([...reportEvents, ...checkinEvents]);
  const display = displayLight(reporter, sys);
  const onTime = onTimeRate(deliverables, now);

  const checkins = mapCheckinHistory(
    (checkinsRes.data ?? []).map((c) => ({
      light: c.light as Light,
      note: c.note as string | null,
      created_by: c.created_by as string,
      created_at: c.created_at as string,
    })),
    nameByEmail
  );

  const competitionLines = await loadCompetitionLinesForGroup(db, groupId, semesterRes.data.red_after_hours as number, now);

  return {
    group: {
      id: groupRes.data.id as string,
      name: groupRes.data.name as string,
      projectName: groupRes.data.project_name as string,
    },
    display,
    onTime,
    periods,
    checkins,
    competitionLines,
  };
}
