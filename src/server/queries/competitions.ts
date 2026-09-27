import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { sortLobby, type CompetitionCard } from "@/domain/competition";
import { isUuid } from "@/domain/id";

export type Lobby = {
  open: CompetitionCard[];
  closed: CompetitionCard[];
  drafts: CompetitionCard[];
  canEdit: boolean;
  // Task 3：學生才會有值——「掛到我們組」按鈕要不要顯示、顯示哪個文案，看這個組有沒有已經
  // 掛過（未退出）這場比賽。key 是 competitionId，value 是那筆報名的 entryId。
  isStudent: boolean;
  myGroupAttached: Record<string, string>;
};

const COLUMNS =
  "id, name, organizer, theme, eligibility, team_size, prize, url, signup_deadline, submission_deadline, final_date, status";

type CompetitionRow = {
  id: string;
  name: string;
  organizer: string | null;
  theme: string | null;
  eligibility: string | null;
  team_size: string | null;
  prize: string | null;
  url: string;
  signup_deadline: string;
  submission_deadline: string | null;
  final_date: string | null;
  status: "draft" | "published";
};

function toCard(row: CompetitionRow): CompetitionCard {
  return {
    id: row.id,
    name: row.name,
    organizer: row.organizer,
    theme: row.theme,
    eligibility: row.eligibility,
    teamSize: row.team_size,
    prize: row.prize,
    url: row.url,
    signupDeadline: new Date(row.signup_deadline),
    submissionDeadline: row.submission_deadline ? new Date(row.submission_deadline) : null,
    finalDate: row.final_date ? new Date(row.final_date) : null,
    status: row.status,
  };
}

// 幹部＝專案幹部／其他幹部（規格第 3 節：新增、編輯、發布競賽——管理員、專案幹部、其他幹部）。
function isStaffOrAdmin(access: Extract<Awaited<ReturnType<typeof getAccess>>, { kind: "ok" }>): boolean {
  return access.isAdmin || access.member?.role === "pm" || access.member?.role === "officer";
}

// 大廳：已發布的卡片依報名截止日排序、分成 open／closed；草稿只給幹部與管理員看
// （canEdit=true 的人）。管理員一律走服務身分——不管管理員自己在名單上有沒有 member 列、
// 掛的是什麼角色，管理員都該看到全部（草稿＋已發布），跟 RLS 是否放行無關。
export async function loadLobby(now: Date = new Date()): Promise<Lobby> {
  const access = await getAccess();
  if (access.kind !== "ok") {
    return { open: [], closed: [], drafts: [], canEdit: false, isStudent: false, myGroupAttached: {} };
  }

  const canEdit = isStaffOrAdmin(access);
  const isStudent = access.member?.role === "student" && !!access.member.groupId;
  const db = access.isAdmin ? createServiceSupabase() : await createServerSupabase();

  const { data, error } = await db.from("competitions").select(COLUMNS).eq("semester_id", access.semesterId);
  if (error) throw error;

  const cards = ((data ?? []) as CompetitionRow[]).map(toCard);
  const published = cards.filter((c) => c.status === "published");
  // Minor 6（fix round 1）：草稿也依報名截止日由近到遠排序，跟 open 區一致，不要留在資料庫
  // 回傳的原始順序（等於「誰先建立」，跟幹部真正關心的「快截止了」無關）。
  const draftCards = canEdit
    ? cards.filter((c) => c.status === "draft").sort((a, b) => a.signupDeadline.getTime() - b.signupDeadline.getTime())
    : [];

  const { open, closed } = sortLobby(published, now);

  let myGroupAttached: Record<string, string> = {};
  if (isStudent && access.member?.groupId) {
    const { data: entries, error: entriesError } = await db
      .from("competition_entries")
      .select("id, competition_id")
      .eq("group_id", access.member.groupId)
      .is("withdrawn_at", null);
    if (entriesError) throw entriesError;
    myGroupAttached = Object.fromEntries((entries ?? []).map((e) => [e.competition_id as string, e.id as string]));
  }

  return { open, closed, drafts: draftCards, canEdit, isStudent, myGroupAttached };
}

// 編輯頁用：看不到（不是幹部／管理員、或這場比賽不屬於本學期、或 id 亂填）一律回傳 null，
// 呼叫端（/competitions/[id]/edit）轉成 404，不透露「這場比賽存在，只是你沒權限看」。
export async function loadCompetition(id: string): Promise<CompetitionCard | null> {
  if (!isUuid(id)) return null;

  const access = await getAccess();
  if (access.kind !== "ok") return null;
  if (!isStaffOrAdmin(access)) return null;

  const db = access.isAdmin ? createServiceSupabase() : await createServerSupabase();
  const { data, error } = await db
    .from("competitions")
    .select(COLUMNS)
    .eq("id", id)
    .eq("semester_id", access.semesterId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return toCard(data as CompetitionRow);
}
