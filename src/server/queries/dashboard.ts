import "server-only";
import { loadAssignments } from "@/server/queries/assignments";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { sortGroupCards, buildGroupCard, foldCompetitionDeadlines, type GroupCard, type GroupCardLine } from "@/domain/dashboard";
import type { Light } from "@/domain/lights";
import { nextRequiredStage, formatStageDeadline, type EntryInput, type StageSubmissionInput } from "@/domain/competition-line";
import { summarizeCompetitionLine } from "@/server/queries/competition-lines";

export type Dashboard = { cards: GroupCard[]; myPmGroupIds: string[] };

// 用 USER-scoped client（createServerSupabase）而不是 service client：幹部只該經由
// line_light_events（狀態視圖，不含三句話／PDF／紅燈說明）看到燈號，read_groups／
// read_lines／read_periods 這些 RLS policy 已經確保「幹部看得到全部組、學生只看得到
// 自己組」。這裡只讀 groups／lines／periods／line_light_events／semesters／
// pm_assignments／members，絕對不直接讀 progress_reports／checkins。
//
// 例外：目前身份是管理員（管理員通常不在名單上，is_staff()／read_groups 等 RLS 條件全部不成立，
// 使用者身分連線什麼都讀不到）——這種情況才退回 service client，但一樣只 select 狀態欄位，不讀
// 內容欄位。
export async function loadDashboard(now: Date = new Date()): Promise<Dashboard> {
  const access = await getAccess();
  // 只有 "ok"，或者「管理員、但這學期還沒建」（no_semester + isAdmin）能往下走——後者
  // 沒有 semesterId 可以查，下面會直接回傳空看板，跟 dashboard/page.tsx 把這種情況導去
  // /admin 建學期是同一件事的另一種呈現（這裡是純函式，不能 redirect）。
  if (access.kind !== "ok" && !(access.kind === "no_semester" && access.isAdmin)) {
    throw new Error("只有幹部與管理員可以看總覽看板");
  }
  if (access.kind !== "ok") {
    return { cards: [], myPmGroupIds: [] };
  }
  // 學生不該走到這裡：(app)/page.tsx／dashboard/page.tsx 已經把學生導去 /my-group，
  // 這裡是查詢層自己的最後一道防線，不依賴呼叫端有沒有記得檢查。
  if (access.active.role === "student") {
    throw new Error("只有幹部與管理員可以看總覽看板");
  }

  const semesterId = access.semesterId;
  // Adjustments Task 3：依「目前身份」。目前身份是管理員 → 服務身分（一樣只讀狀態欄位）；
  // 幹部身份 → 使用者連線（RLS 是所有身份的聯集，但這裡本來就只讀狀態欄位，不讀內容）。
  const useService = access.active.role === "admin";
  const pmMemberId = access.active.role === "pm" ? access.active.memberId : null;
  const isPm = pmMemberId !== null;

  const db = useService ? createServiceSupabase() : await createServerSupabase();

  // 作業的狀態（交了沒、繳交時間），算進各組專案線（§17-6）；跟下面的查詢互不依賴，先發出去。
  const assignmentsPromise = loadAssignments(db, semesterId);

  const [groupsRes, periodsRes, semesterRes] = await Promise.all([
    db.from("groups").select("id, name, project_name, note").eq("semester_id", semesterId).order("name"),
    db.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq"),
    db.from("semesters").select("red_after_hours").eq("id", semesterId).single(),
  ]);

  if (groupsRes.error) throw groupsRes.error;
  if (periodsRes.error) throw periodsRes.error;
  if (semesterRes.error) throw semesterRes.error;

  const groups = groupsRes.data ?? [];
  const groupIds = groups.map((g) => g.id as string);

  // lines／pm_assignments 都要等 groups 查完才知道要用哪些 group id 去縮小範圍，沒辦法
  // 跟上面那三個一起丟進同一個 Promise.all；lines 這裡直接用 .in(group_id, ...) 讓資料庫
  // 端就只回目前學期的組別的專案線，不要整張表撈回來自己用 groupIds Set 過濾——尤其是
  // service client 那條路（管理員沒有 member 列），少了 RLS 幫忙擋，撈整張表更沒道理。
  // pm_assignments 只有專案幹部自己需要（用來算 myPmGroupIds），其他幹部／管理員一律是
  // 空陣列，查了也用不到，直接跳過這次查詢。
  const [linesRes, competitionLinesRes, pmRes, membersRes] = await Promise.all([
    groupIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; group_id: string }[], error: null })
      : db.from("lines").select("id, group_id").eq("kind", "project").in("group_id", groupIds),
    groupIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; group_id: string; entry_id: string }[], error: null })
      : db.from("lines").select("id, group_id, entry_id").eq("kind", "competition").in("group_id", groupIds),
    isPm
      ? db.from("pm_assignments").select("pm_member_id, group_id")
      : Promise.resolve({ data: [] as { pm_member_id: string; group_id: string }[], error: null }),
    // 看板卡片組員清單（規格 §14 第 5 點）：只要姓名與系級，不要學號（只在管理員頁與
    // /groups/[id] 顯示）——刻意少選一欄，不是漏選。
    groupIds.length === 0
      ? Promise.resolve({ data: [] as { group_id: string; name: string; dept_year: string | null }[], error: null })
      : db.from("members").select("group_id, name, dept_year").eq("role", "student").in("group_id", groupIds).is("left_at", null),
  ]);

  if (linesRes.error) throw linesRes.error;
  if (competitionLinesRes.error) throw competitionLinesRes.error;
  if (pmRes.error) throw pmRes.error;
  if (membersRes.error) throw membersRes.error;

  const lines = linesRes.data ?? [];
  const lineIds = lines.map((l) => l.id as string);
  const competitionLines = competitionLinesRes.data ?? [];
  const competitionLineIds = competitionLines.map((l) => l.id as string);
  const entryIds = competitionLines.map((l) => l.entry_id as string);

  const [eventsRes, entriesRes] = await Promise.all([
    lineIds.length === 0
      ? Promise.resolve({ data: [] as { line_id: string; light: Light; at: string; period_id: string | null }[], error: null })
      : db.from("line_light_events").select("line_id, light, at, period_id").in("line_id", lineIds),
    entryIds.length === 0
      ? Promise.resolve({
          data: [] as { id: string; confirmed_at: string | null; withdrawn_at: string | null; result: string | null; competition_id: string }[],
          error: null,
        })
      : db.from("competition_entries").select("id, confirmed_at, withdrawn_at, result, competition_id").in("id", entryIds),
  ]);
  if (eventsRes.error) throw eventsRes.error;
  if (entriesRes.error) throw entriesRes.error;

  const entries = entriesRes.data ?? [];
  const competitionIds = [...new Set(entries.map((e) => e.competition_id as string))];

  const [competitionsRes, stageStatusRes] = await Promise.all([
    competitionIds.length === 0
      ? Promise.resolve({
          data: [] as { id: string; name: string; signup_deadline: string; submission_deadline: string | null; final_date: string | null }[],
          error: null,
        })
      : db.from("competitions").select("id, name, signup_deadline, submission_deadline, final_date").in("id", competitionIds),
    competitionLineIds.length === 0
      ? Promise.resolve({ data: [] as { line_id: string; stage: string; version: number; pdf_uploaded_at: string; review_status: string }[], error: null })
      : db.from("stage_status").select("line_id, stage, version, pdf_uploaded_at, review_status").in("line_id", competitionLineIds),
  ]);
  if (competitionsRes.error) throw competitionsRes.error;
  if (stageStatusRes.error) throw stageStatusRes.error;

  const competitionsById = new Map((competitionsRes.data ?? []).map((c) => [c.id as string, c]));
  const entriesById = new Map(entries.map((e) => [e.id as string, e]));
  const stageStatusByLine = new Map<string, { stage: string; version: number; pdf_uploaded_at: string; review_status: string }[]>();
  for (const row of stageStatusRes.data ?? []) {
    const arr = stageStatusByLine.get(row.line_id as string) ?? [];
    arr.push(row);
    stageStatusByLine.set(row.line_id as string, arr);
  }

  const assignments = await assignmentsPromise;

  const periods = (periodsRes.data ?? []).map((p) => ({ id: p.id as string, seq: p.seq as number, deadline: new Date(p.deadline as string) }));
  const seqByPeriodId = new Map(periods.map((p) => [p.id, p.seq]));
  const redAfterHours = semesterRes.data.red_after_hours as number;

  const cards: GroupCard[] = [];
  for (const group of groups) {
    const line = lines.find((l) => l.group_id === group.id);
    if (!line) continue;

    const lineId = line.id as string;
    const lineEvents = (eventsRes.data ?? []).filter((e) => e.line_id === lineId);
    const submissions = lineEvents
      .filter((e) => e.period_id !== null)
      .map((e) => ({ periodSeq: seqByPeriodId.get(e.period_id as string) as number, submittedAt: new Date(e.at) }));

    const groupMembers = (membersRes.data ?? [])
      .filter((m) => m.group_id === group.id)
      .map((m) => ({ name: m.name as string, deptYear: (m.dept_year as string | null) ?? null }));

    const groupCard = buildGroupCard({
      group: { id: group.id as string, name: group.name as string, projectName: (group.project_name as string | null) ?? null },
      lineId,
      periods: periods.map((p) => ({ seq: p.seq, deadline: p.deadline })),
      submissions,
      events: lineEvents.map((e) => ({ light: e.light, at: new Date(e.at) })),
      now,
      redAfterHours,
      note: (group.note as string | null) ?? null,
      members: groupMembers,
      assignments: assignments.flatMap((a) => {
        const g = a.groups.find((x) => x.groupId === group.id);
        return g ? [{ title: a.title, deadline: a.deadline, submittedAt: g.submittedAt }] : [];
      }),
    });

    // fix round 1（controller ruling）：已退出的比賽線從看板整個濾掉，不出現在組卡上——不是
    // 「顯示但沒有燈」，是「這條線跟這組現在的看板無關」。未入選／得獎的線留著，用成果徽章
    // （得獎／未入選）取代燈號。
    const groupCompetitionLines = competitionLines
      .filter((cl) => cl.group_id === group.id)
      .map((cl) => {
        const entry = entriesById.get(cl.entry_id as string);
        const competition = entry ? competitionsById.get(entry.competition_id as string) : undefined;
        if (!entry || !competition) return null;
        if (entry.withdrawn_at) return null;

        const stageSubmissions: StageSubmissionInput[] = (stageStatusByLine.get(cl.id as string) ?? []).map((s) => ({
          stage: s.stage as StageSubmissionInput["stage"],
          version: s.version,
          pdfUploadedAt: new Date(s.pdf_uploaded_at),
          reviewStatus: s.review_status as StageSubmissionInput["reviewStatus"],
        }));

        const entryInput: EntryInput = {
          confirmedAt: entry.confirmed_at ? new Date(entry.confirmed_at as string) : null,
          withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at as string) : null,
          result: entry.result as EntryInput["result"],
        };

        const summary = summarizeCompetitionLine({
          lineId: cl.id as string,
          entryId: cl.entry_id as string,
          competition: {
            name: competition.name as string,
            signupDeadline: new Date(competition.signup_deadline as string),
            submissionDeadline: competition.submission_deadline ? new Date(competition.submission_deadline as string) : null,
            finalDate: competition.final_date ? new Date(competition.final_date as string) : null,
          },
          entry: entryInput,
          submissions: stageSubmissions,
          now,
          redAfterHours,
        });

        // Final review IMPORTANT 2（規格 4.6）：每條比賽線附上下一個必要、還沒完成的階段截止日。
        const next = nextRequiredStage(summary.stages);
        return {
          lineId: summary.lineId,
          kind: "competition" as const,
          label: summary.competitionName,
          status: summary.status,
          light: summary.light,
          source: summary.source,
          onTime: summary.onTime,
          nextStage: next ? { label: next.label, at: next.deadline, text: formatStageDeadline(next.deadline, now) } : null,
        };
      })
      .filter((l) => l !== null) as GroupCardLine[];

    groupCard.lines.push(...groupCompetitionLines);
    cards.push(foldCompetitionDeadlines(groupCard, now));
  }

  const myPmGroupIds =
    pmMemberId !== null
      ? (pmRes.data ?? []).filter((p) => p.pm_member_id === pmMemberId).map((p) => p.group_id as string)
      : [];

  return { cards: sortGroupCards(cards), myPmGroupIds };
}
