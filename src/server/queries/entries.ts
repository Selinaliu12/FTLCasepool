import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { isUuid } from "@/domain/id";
import { entryStatus, type EntryStatus } from "@/domain/entries";

export type MyGroupEntry = {
  entryId: string;
  competitionName: string;
  status: EntryStatus;
};

// /my-group 頁的「比賽」區塊：這個組掛過的所有報名（含已退出的，狀態顯示已退出）。用
// user-scoped client：read_entries 的 RLS（is_staff() or group_id = my_group()）本來就會讓
// 這個組的學生看到自己組的報名，不需要 service client。
export async function loadMyGroupEntries(): Promise<MyGroupEntry[]> {
  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || !access.member.groupId) return [];

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("competition_entries")
    .select("id, confirmed_at, withdrawn_at, competitions(name)")
    .eq("group_id", access.member.groupId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const competition = row.competitions as unknown as { name: string } | { name: string }[] | null;
    const name = Array.isArray(competition) ? competition[0]?.name : competition?.name;
    return {
      entryId: row.id as string,
      competitionName: name ?? "",
      status: entryStatus({
        confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string) : null,
        withdrawnAt: row.withdrawn_at ? new Date(row.withdrawn_at as string) : null,
      }),
    };
  });
}

export type EntryDetail = {
  entryId: string;
  competitionName: string;
  competitionUrl: string;
  status: EntryStatus;
  confirmedAt: Date | null;
  withdrawnAt: Date | null;
  groupStudents: { id: string; name: string }[];
  selectedMemberIds: string[];
  // controller ruling（fix round 1）：學生確認報名之後如果換組，entry_members 裡那筆紀錄留著
  // （不刪）；顯示的時候要標成「已換組」，不能直接消失——不然看起來像這個人從沒參加過。
  // movedOut = 這個 member 現在的 group_id 已經不是這筆報名的組。
  selectedMembers: { id: string; name: string; movedOut: boolean }[];
};

// 報名頁（/my-group/competitions/[entryId]）：找不到（不是這組的、id 亂填、根本不存在）一律
// 回傳 null，呼叫端轉成 404，不透露「這筆報名存在，只是不是你的組」。
export async function loadEntryDetail(entryId: string): Promise<EntryDetail | null> {
  if (!isUuid(entryId)) return null;

  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return null;
  }

  const groupId = access.member.groupId;

  const supabase = await createServerSupabase();
  const { data: entry, error } = await supabase
    .from("competition_entries")
    .select("id, confirmed_at, withdrawn_at, group_id, competitions(name, url)")
    .eq("id", entryId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) throw error;
  if (!entry) return null;

  const competition = entry.competitions as unknown as { name: string; url: string } | { name: string; url: string }[] | null;
  const competitionRow = Array.isArray(competition) ? competition[0] : competition;

  const { data: students, error: studentsError } = await supabase
    .from("members")
    .select("id, name")
    .eq("group_id", groupId)
    .eq("role", "student")
    .order("name");
  if (studentsError) throw studentsError;

  const { data: selected, error: selectedError } = await supabase
    .from("entry_members")
    .select("member_id")
    .eq("entry_id", entryId);
  if (selectedError) throw selectedError;
  const selectedMemberIds = (selected ?? []).map((s) => s.member_id as string);

  // 已經選過的成員可能換組了：這組的學生（read_members 的 RLS）看不到別組成員現在的 member
  // 列（group_id 已經不是 my_group()），所以這裡用 service client 單獨查這幾個 id 的
  // 名字／目前的 group_id——只回傳名字跟「有沒有換組」，不會多洩漏其他資訊。
  let selectedMembers: { id: string; name: string; movedOut: boolean }[] = [];
  if (selectedMemberIds.length > 0) {
    const service = createServiceSupabase();
    const { data: memberRows, error: memberError } = await service
      .from("members")
      .select("id, name, group_id")
      .in("id", selectedMemberIds);
    if (memberError) throw memberError;
    const byId = new Map((memberRows ?? []).map((m) => [m.id as string, m]));
    selectedMembers = selectedMemberIds.map((id) => {
      const row = byId.get(id);
      return {
        id,
        name: (row?.name as string | undefined) ?? "",
        movedOut: (row?.group_id as string | null | undefined) !== groupId,
      };
    });
  }

  return {
    entryId: entry.id as string,
    competitionName: competitionRow?.name ?? "",
    competitionUrl: competitionRow?.url ?? "",
    confirmedAt: entry.confirmed_at ? new Date(entry.confirmed_at as string) : null,
    withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at as string) : null,
    status: entryStatus({
      confirmedAt: entry.confirmed_at ? new Date(entry.confirmed_at as string) : null,
      withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at as string) : null,
    }),
    groupStudents: (students ?? []).map((s) => ({ id: s.id as string, name: s.name as string })),
    selectedMemberIds,
    selectedMembers,
  };
}
