import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import type { Light, Deliverable } from "@/domain/lights";
import { systemLight, reporterLight, displayLight, periodLabel } from "@/domain/lights";
import { onTimeRate } from "@/domain/on-time";
import { submissionTiming } from "@/domain/progress";
import { mapCheckinHistory, type CheckinHistoryEntry } from "@/domain/checkin-history";
import { isUuid } from "@/domain/id";
import { sortMembersByName } from "@/domain/dashboard";
import { nameByEmailMap } from "@/domain/member-name";
import { loadCompetitionLinesForGroup, type CompetitionLineSummary } from "@/server/queries/competition-lines";
import { loadGroupAssignments, type GroupAssignment } from "@/server/queries/assignments";

// /groups/[id]：姓名、學號、系級——這裡跟管理員頁是唯二顯示學號的地方（規格 §14 第 1 點）。
export type GroupDetailMember = { name: string; studentId: string | null; deptYear: string | null };

// 已交的一期：狀態（燈號、繳交時間、準不準時）人人都有；content 只有看得到內容的人才有（§17-12）。
export type GroupDetailReportContent = {
  reportId: string;
  did: string;
  blocked: string;
  nextSteps: string;
  submittedBy: string;
};

export type GroupDetailPeriod = {
  seq: number;
  deadline: Date;
  report:
    | null
    | {
        light: Light;
        submittedAt: Date;
        timing: { late: boolean; label: string };
        content: GroupDetailReportContent | null;
      };
};

export type GroupDetail = {
  // false＝只看狀態（專案幹部看非負責的組，§17-14）：沒有三句話、PDF、紅燈說明、階段檔案、評語。
  contentVisible: boolean;
  group: {
    id: string;
    name: string;
    projectName: string | null;
    note: string | null;
    noteUpdatedBy: string | null;
    noteUpdatedAt: Date | null;
    members: GroupDetailMember[];
  };
  display: { light: Light; source: string };
  onTime: number | null;
  periods: GroupDetailPeriod[];
  checkins: CheckinHistoryEntry[];
  competitionLines: CompetitionLineSummary[];
  // 被派到的作業（§17）：content 只有看得到那份繳交的人才有（出題者看自己出的也有）。
  assignments: GroupAssignment[];
};

// 規格第 3 節＋§17-12～14「看進度內容（三句話、PDF、紅燈說明）」：管理員 ✓、專案幹部只看負責的組
// （非負責的組進「只看狀態」版本）、其他幹部 ✗、專案生只看自己組。專案幹部與學生走使用者身分連線，
// 讓 RLS（can_read_content：自己組或負責的組）真的決定看不看得到內容；其他幹部即使 RLS 本身沒擋 groups 這張表
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

  // Controller ruling（Task 14 fix round 1）：規格第 3 節「看進度內容」管理員 ✓——管理員身分
  // 本身就該看得到全部內容。Adjustments Task 3：一律看「目前身份」（規格 §14 第 3 點）：
  // 目前身份是管理員才走服務身分；專案生只看目前這組（就算他同時是別組專案生、RLS 聯集讀得到，
  // 頁面也只依目前身份）；其他幹部看不到內容。
  const active = access.active;
  const useService = active.role === "admin";
  if (!useService) {
    if (active.role === "student" && active.groupId !== groupId) return null;
    // catch-all：只有 pm／student 能走到這裡繼續往下查；officer 在這裡就被擋掉。
    if (active.role !== "pm" && active.role !== "student") return null;
  }

  const db = useService ? createServiceSupabase() : await createServerSupabase();
  const semesterId = access.semesterId;

  const [groupRes, lineRes, periodsRes, semesterRes, membersRes, groupMembersRes] = await Promise.all([
    db
      .from("groups")
      .select("id, name, project_name, note, note_updated_by, note_updated_at")
      .eq("id", groupId)
      .eq("semester_id", semesterId)
      .maybeSingle(),
    db.from("lines").select("id").eq("group_id", groupId).eq("kind", "project").maybeSingle(),
    db.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq"),
    db.from("semesters").select("red_after_hours").eq("id", semesterId).single(),
    // 紀錄上的名字（交件人、點燈的人）：含已離開的列，已離開的人顯示「姓名（已離開）」（Task 7）。
    db.from("members").select("email, name, left_at").eq("semester_id", semesterId),
    // 這組組員的姓名、學號、系級——規格 §14 第 1、7 點，跟看板卡片／my-group 不同，這裡要含學號。
    // 已離開的人不列（Task 7）。
    db.from("members").select("name, student_id, dept_year").eq("group_id", groupId).eq("role", "student").is("left_at", null),
  ]);

  if (groupRes.error) throw groupRes.error;
  if (lineRes.error) throw lineRes.error;
  if (periodsRes.error) throw periodsRes.error;
  if (semesterRes.error) throw semesterRes.error;
  if (membersRes.error) throw membersRes.error;
  if (groupMembersRes.error) throw groupMembersRes.error;

  // 其他幹部、別組學生在 !useService 分支已經被擋掉；這裡的 null 涵蓋「groupId 亂填」或
  // RLS 擋下（理論上不會發生在通過上面檢查的角色，屬於防禦性檢查）兩種情況。
  if (!groupRes.data || !lineRes.data) return null;

  const lineId = lineRes.data.id as string;

  // 看不看得到內容交給資料庫的同一個判斷（can_read_content），不在這裡另寫一套「負責哪幾組」。
  let contentVisible = useService;
  if (!useService) {
    const { data: canRead, error: canReadError } = await db.rpc("can_read_content", { l: lineId });
    if (canReadError) throw canReadError;
    contentVisible = canRead === true;
  }

  // 只看狀態：燈號與繳交時間改讀 line_light_events（狀態視圖，不含三句話、說明、交件人）。
  const [reportsRes, checkinsRes] = contentVisible
    ? await Promise.all([
        db
          .from("progress_reports")
          .select("id, period_id, light, did, blocked, next_steps, submitted_by, pdf_uploaded_at")
          .eq("line_id", lineId),
        db.from("checkins").select("light, note, created_by, created_at").eq("line_id", lineId).order("created_at", { ascending: false }),
      ])
    : await statusOnlyRows(db, lineId);
  if (reportsRes.error) throw reportsRes.error;
  if (checkinsRes.error) throw checkinsRes.error;

  const nameByEmail = nameByEmailMap(
    (membersRes.data ?? []).map((m) => ({ email: m.email as string, name: m.name as string, left_at: (m.left_at as string | null) ?? null }))
  );
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
        light: report.light as Light,
        submittedAt,
        timing: submissionTiming(deadline, submittedAt),
        content: contentVisible
          ? {
              reportId: report.id as string,
              did: report.did as string,
              blocked: report.blocked as string,
              nextSteps: report.next_steps as string,
              submittedBy: nameByEmail.get(report.submitted_by as string) ?? (report.submitted_by as string),
            }
          : null,
      },
    };
  });

  const assignments = await loadGroupAssignments(db, semesterId, groupId, nameByEmail);

  const deliverables: Deliverable[] = [
    ...periods.map((p) => ({
      label: periodLabel(p.seq),
      deadline: p.deadline,
      submittedAt: p.report?.submittedAt ?? null,
    })),
    ...assignments.deliverables,
  ];

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

  // 中間週燈號的歷程含紅燈說明與點燈的人，屬於內容；只看狀態時不列（燈號已反映在顯示燈）。
  const checkins = !contentVisible ? [] : mapCheckinHistory(
    (checkinsRes.data ?? []).map((c) => ({
      light: c.light as Light,
      note: c.note as string | null,
      created_by: c.created_by as string,
      created_at: c.created_at as string,
    })),
    nameByEmail
  );

  const competitionLines = await loadCompetitionLinesForGroup(db, groupId, semesterRes.data.red_after_hours as number, now);

  const members = sortMembersByName(
    (groupMembersRes.data ?? []).map((m) => ({
      name: m.name as string,
      studentId: (m.student_id as string | null) ?? null,
      deptYear: (m.dept_year as string | null) ?? null,
    }))
  );

  return {
    contentVisible,
    group: {
      id: groupRes.data.id as string,
      name: groupRes.data.name as string,
      projectName: (groupRes.data.project_name as string | null) ?? null,
      note: (groupRes.data.note as string | null) ?? null,
      noteUpdatedBy: (groupRes.data.note_updated_by as string | null) ?? null,
      noteUpdatedAt: groupRes.data.note_updated_at ? new Date(groupRes.data.note_updated_at as string) : null,
      members,
    },
    display,
    onTime,
    periods,
    checkins,
    competitionLines,
    assignments: assignments.list,
  };
}

type Rows = { data: Record<string, unknown>[] | null; error: unknown };

// 只看狀態版本：從 line_light_events 拼出跟本表同形狀的列（內容欄位留空），讓後面的燈號、準時率
// 計算共用同一段程式。period_id 有值的是雙週進度，沒有的是中間週燈號。
async function statusOnlyRows(
  db: Awaited<ReturnType<typeof createServerSupabase>>,
  lineId: string
): Promise<[Rows, Rows]> {
  const { data, error } = await db.from("line_light_events").select("light, at, period_id").eq("line_id", lineId);
  if (error) return [{ data: null, error }, { data: null, error }];
  const rows = data ?? [];
  return [
    { data: rows.filter((r) => r.period_id).map((r) => ({ period_id: r.period_id, light: r.light, pdf_uploaded_at: r.at })), error: null },
    { data: rows.filter((r) => !r.period_id).map((r) => ({ light: r.light, created_at: r.at })), error: null },
  ];
}
