import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { sortGroupCards, buildGroupCard, type GroupCard } from "@/domain/dashboard";
import type { Light } from "@/domain/lights";

export type Dashboard = { cards: GroupCard[]; myPmGroupIds: string[] };

// 用 USER-scoped client（createServerSupabase）而不是 service client：幹部只該經由
// line_light_events（狀態視圖，不含三句話／PDF／紅燈說明）看到燈號，read_groups／
// read_lines／read_periods 這些 RLS policy 已經確保「幹部看得到全部組、學生只看得到
// 自己組」。這裡只讀 groups／lines／periods／line_light_events／semesters／
// pm_assignments／members，絕對不直接讀 progress_reports／checkins。
//
// 例外：管理員如果自己不是任何學期的 member（一般情況，管理員信箱不會被匯入名單），
// me() 回傳 null，is_staff()／read_groups 等 RLS 條件全部不成立，使用者身分連線什麼都
// 讀不到——這種情況才退回 service client，但一樣只 select 狀態欄位，不讀內容欄位。
export async function loadDashboard(now: Date = new Date()): Promise<Dashboard> {
  const access = await getAccess();
  if (access.kind !== "ok") throw new Error("只有幹部與管理員能看到總覽看板");

  const semesterId = access.semesterId;
  const useService = access.isAdmin && !access.member;

  const db = useService ? createServiceSupabase() : await createServerSupabase();

  const [groupsRes, linesRes, periodsRes, semesterRes, pmRes] = await Promise.all([
    db.from("groups").select("id, name, project_name").eq("semester_id", semesterId).order("name"),
    db.from("lines").select("id, group_id").eq("kind", "project"),
    db.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq"),
    db.from("semesters").select("red_after_hours").eq("id", semesterId).single(),
    db.from("pm_assignments").select("pm_member_id, group_id"),
  ]);

  if (groupsRes.error) throw groupsRes.error;
  if (linesRes.error) throw linesRes.error;
  if (periodsRes.error) throw periodsRes.error;
  if (semesterRes.error) throw semesterRes.error;
  if (pmRes.error) throw pmRes.error;

  const groups = groupsRes.data ?? [];
  const groupIds = new Set(groups.map((g) => g.id as string));
  const lines = (linesRes.data ?? []).filter((l) => groupIds.has(l.group_id as string));
  const lineIds = lines.map((l) => l.id as string);

  const { data: eventsData, error: eventsError } =
    lineIds.length === 0
      ? { data: [] as { line_id: string; light: Light; at: string; period_id: string | null }[], error: null }
      : await db.from("line_light_events").select("line_id, light, at, period_id").in("line_id", lineIds);
  if (eventsError) throw eventsError;

  const periods = (periodsRes.data ?? []).map((p) => ({ id: p.id as string, seq: p.seq as number, deadline: new Date(p.deadline as string) }));
  const seqByPeriodId = new Map(periods.map((p) => [p.id, p.seq]));
  const redAfterHours = semesterRes.data.red_after_hours as number;

  const cards: GroupCard[] = [];
  for (const group of groups) {
    const line = lines.find((l) => l.group_id === group.id);
    if (!line) continue;

    const lineId = line.id as string;
    const lineEvents = (eventsData ?? []).filter((e) => e.line_id === lineId);
    const submissions = lineEvents
      .filter((e) => e.period_id !== null)
      .map((e) => ({ periodSeq: seqByPeriodId.get(e.period_id as string) as number, submittedAt: new Date(e.at) }));

    cards.push(
      buildGroupCard({
        group: { id: group.id as string, name: group.name as string, projectName: group.project_name as string },
        lineId,
        periods: periods.map((p) => ({ seq: p.seq, deadline: p.deadline })),
        submissions,
        events: lineEvents.map((e) => ({ light: e.light, at: new Date(e.at) })),
        now,
        redAfterHours,
      })
    );
  }

  const myPmGroupIds =
    access.member?.role === "pm"
      ? (pmRes.data ?? []).filter((p) => p.pm_member_id === access.member!.id).map((p) => p.group_id as string)
      : [];

  return { cards: sortGroupCards(cards), myPmGroupIds };
}
