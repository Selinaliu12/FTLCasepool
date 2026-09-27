import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase } from "@/server/supabase";
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
};

// 報名頁（/my-group/competitions/[entryId]）：找不到（不是這組的、id 亂填、根本不存在）一律
// 回傳 null，呼叫端轉成 404，不透露「這筆報名存在，只是不是你的組」。
export async function loadEntryDetail(entryId: string): Promise<EntryDetail | null> {
  if (!isUuid(entryId)) return null;

  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return null;
  }

  const supabase = await createServerSupabase();
  const { data: entry, error } = await supabase
    .from("competition_entries")
    .select("id, confirmed_at, withdrawn_at, group_id, competitions(name, url)")
    .eq("id", entryId)
    .eq("group_id", access.member.groupId)
    .maybeSingle();
  if (error) throw error;
  if (!entry) return null;

  const competition = entry.competitions as unknown as { name: string; url: string } | { name: string; url: string }[] | null;
  const competitionRow = Array.isArray(competition) ? competition[0] : competition;

  const { data: students, error: studentsError } = await supabase
    .from("members")
    .select("id, name")
    .eq("group_id", access.member.groupId)
    .eq("role", "student")
    .order("name");
  if (studentsError) throw studentsError;

  const { data: selected, error: selectedError } = await supabase
    .from("entry_members")
    .select("member_id")
    .eq("entry_id", entryId);
  if (selectedError) throw selectedError;

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
    selectedMemberIds: (selected ?? []).map((s) => s.member_id as string),
  };
}
