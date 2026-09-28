import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccess } from "@/server/session";
import { activeStudentGroup, isStaffIdentity } from "@/domain/access";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { sortLobby, normalizeTags, type CompetitionCard } from "@/domain/competition";
import { isUuid } from "@/domain/id";
import { sortNatural } from "@/domain/natural-sort";

export type Lobby = {
  open: CompetitionCard[];
  closed: CompetitionCard[];
  drafts: CompetitionCard[];
  canEdit: boolean;
  // Task 3：學生才會有值——「掛到我們組」按鈕要不要顯示、顯示哪個文案，看這個組有沒有已經
  // 掛過（未退出）這場比賽。key 是 competitionId，value 是那筆報名的 entryId。
  isStudent: boolean;
  myGroupAttached: Record<string, string>;
  // Task 2（規格第 15 節 #7）：每組都看得到別組掛了哪些比賽——只有組名。key 是
  // competitionId，value 是依組名自然排序（第2組在第10組前）的組名清單，退出的組不列，
  // 同一組不會出現兩次。
  attachedGroups: Record<string, string[]>;
};

const COLUMNS =
  "id, name, organizer, theme, eligibility, team_size, prize, url, signup_deadline, submission_deadline, final_date, status, summary, tags, max_prize, perks, info_session_at, signup_note, submission_note, final_note, final_format, fee, documents, skills, recommended, staff_note" as const;

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
  summary: string | null;
  tags: string[];
  max_prize: number | null;
  perks: string | null;
  info_session_at: string | null;
  signup_note: string | null;
  submission_note: string | null;
  final_note: string | null;
  final_format: string | null;
  fee: string | null;
  documents: string | null;
  skills: string | null;
  recommended: boolean;
  staff_note: string | null;
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
    summary: row.summary,
    tags: normalizeTags(row.tags ?? []),
    maxPrize: row.max_prize,
    perks: row.perks,
    infoSessionAt: row.info_session_at ? new Date(row.info_session_at) : null,
    signupNote: row.signup_note,
    submissionNote: row.submission_note,
    finalNote: row.final_note,
    finalFormat: row.final_format,
    fee: row.fee,
    documents: row.documents,
    skills: row.skills,
    recommended: row.recommended,
    staffNote: row.staff_note,
  };
}

function groupRowsByCompetition(rows: { competition_id: string; group_name: string }[]): Record<string, string[]> {
  const byId = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byId.get(row.competition_id) ?? new Set<string>();
    set.add(row.group_name);
    byId.set(row.competition_id, set);
  }
  const result: Record<string, string[]> = {};
  for (const [id, names] of byId) {
    result[id] = sortNatural([...names]);
  }
  return result;
}

// 已掛上的組別：管理員（沒有名單列、走服務身分）用跟 SQL 版 competition_attached_groups()
// 完全一樣的篩選條件做等價查詢（service client 略過 RLS，不能只靠 RLS 擋，得自己重現：已發布、
// 本學期、group 也要是本學期的、未退出）；其他人一律呼叫 competition_attached_groups()
// （SECURITY DEFINER，呼叫者必須在本學期名單上，見
// supabase/migrations/20260929000002_attached_groups.sql）。
//
// fix round 1（F2）：groups 查詢加回 semester_id 篩選（跟 SQL 版的 g.semester_id =
// c.semester_id 對齊）；找不到組名的 entry 直接丟掉（SQL 版是 inner join，找不到就整列不存
// 在），不再用 "" 頂替——正常資料不會走到這裡，但等價查詢就該完全等價。
//
// fix round 1（F6）：多一個 competitionId 參數，兩條路徑都在查詢階段就narrow到單一比賽，不是
// 撈全部再篩選（RPC 沒有參數化篩選比賽的入口，改成拿到全部 rows 後在這裡 filter；admin 路徑
// 直接在 SQL 查詢上加 .eq("id", competitionId) 窄化）。
async function fetchAttachedGroupsRows(
  db: SupabaseClient,
  isAdmin: boolean,
  semesterId: string,
  competitionId?: string
): Promise<{ competition_id: string; group_name: string }[]> {
  if (!isAdmin) {
    const { data, error } = await db.rpc("competition_attached_groups");
    if (error) throw error;
    const rows = (data ?? []) as { competition_id: string; group_name: string }[];
    return competitionId ? rows.filter((r) => r.competition_id === competitionId) : rows;
  }

  let compsQuery = db.from("competitions").select("id").eq("semester_id", semesterId).eq("status", "published");
  compsQuery = competitionId ? compsQuery.eq("id", competitionId) : compsQuery;
  const { data: comps, error: compsError } = await compsQuery;
  if (compsError) throw compsError;
  const competitionIds = (comps ?? []).map((c) => c.id as string);
  if (competitionIds.length === 0) return [];

  const { data: entries, error: entriesError } = await db
    .from("competition_entries")
    .select("competition_id, group_id")
    .in("competition_id", competitionIds)
    .is("withdrawn_at", null);
  if (entriesError) throw entriesError;
  if (!entries || entries.length === 0) return [];

  const groupIds = [...new Set(entries.map((e) => e.group_id as string))];
  const { data: groups, error: groupsError } = await db
    .from("groups")
    .select("id, name")
    .eq("semester_id", semesterId)
    .in("id", groupIds);
  if (groupsError) throw groupsError;
  const nameById = new Map((groups ?? []).map((g) => [g.id as string, g.name as string]));

  const rows: { competition_id: string; group_name: string }[] = [];
  for (const e of entries) {
    const groupName = nameById.get(e.group_id as string);
    if (groupName === undefined) continue; // 等價於 SQL 版的 inner join：找不到就整列不存在。
    rows.push({ competition_id: e.competition_id as string, group_name: groupName });
  }
  return rows;
}

// 幹部＝專案幹部／其他幹部（規格第 3 節：新增、編輯、發布競賽——管理員、專案幹部、其他幹部）。
function isStaffOrAdmin(access: Extract<Awaited<ReturnType<typeof getAccess>>, { kind: "ok" }>): boolean {
  return isStaffIdentity(access.active);
}

// 大廳：已發布的卡片依報名截止日排序、分成 open／closed；草稿只給幹部與管理員看
// （canEdit=true 的人）。目前身份是管理員時一律走服務身分——不管管理員自己在名單上有沒有 member 列、
// 掛的是什麼角色，管理員都該看到全部（草稿＋已發布），跟 RLS 是否放行無關。
export async function loadLobby(now: Date = new Date()): Promise<Lobby> {
  const access = await getAccess();
  if (access.kind !== "ok") {
    return { open: [], closed: [], drafts: [], canEdit: false, isStudent: false, myGroupAttached: {}, attachedGroups: {} };
  }

  const canEdit = isStaffOrAdmin(access);
  const studentGroupId = activeStudentGroup(access);
  const isStudent = !!studentGroupId;
  const db = access.active.role === "admin" ? createServiceSupabase() : await createServerSupabase();

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
  if (studentGroupId) {
    const { data: entries, error: entriesError } = await db
      .from("competition_entries")
      .select("id, competition_id")
      .eq("group_id", studentGroupId)
      .is("withdrawn_at", null);
    if (entriesError) throw entriesError;
    myGroupAttached = Object.fromEntries((entries ?? []).map((e) => [e.competition_id as string, e.id as string]));
  }

  const isAdmin = access.active.role === "admin";
  const attachedRows = await fetchAttachedGroupsRows(db, isAdmin, access.semesterId);
  const attachedGroups = groupRowsByCompetition(attachedRows);

  return { open, closed, drafts: draftCards, canEdit, isStudent, myGroupAttached, attachedGroups };
}

// 詳細頁（Task 4）用：單一比賽的「已掛上的組別」，跟 loadLobby 的 attachedGroups 走同一套
// 規則與資料來源，只是只回傳一場比賽的組名清單。看不到（未登入、不在名單上）一律回傳空陣列，
// 不報錯——詳細頁本身的可見性判斷（草稿 404）不是這個函式的責任。
export async function loadAttachedGroups(competitionId: string): Promise<string[]> {
  if (!isUuid(competitionId)) return [];

  const access = await getAccess();
  if (access.kind !== "ok") return [];

  const isAdmin = access.active.role === "admin";
  const db = isAdmin ? createServiceSupabase() : await createServerSupabase();
  const rows = await fetchAttachedGroupsRows(db, isAdmin, access.semesterId, competitionId);
  return groupRowsByCompetition(rows)[competitionId] ?? [];
}

// 編輯頁用：看不到（不是幹部／管理員、或這場比賽不屬於本學期、或 id 亂填）一律回傳 null，
// 呼叫端（/competitions/[id]/edit）轉成 404，不透露「這場比賽存在，只是你沒權限看」。
export async function loadCompetition(id: string): Promise<CompetitionCard | null> {
  if (!isUuid(id)) return null;

  const access = await getAccess();
  if (access.kind !== "ok") return null;
  if (!isStaffOrAdmin(access)) return null;

  const db = access.active.role === "admin" ? createServiceSupabase() : await createServerSupabase();
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
