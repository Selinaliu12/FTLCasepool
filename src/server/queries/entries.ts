import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { isUuid } from "@/domain/id";
import { entryStatus, type EntryStatus } from "@/domain/entries";
import {
  competitionStages,
  type Stage,
  type StageKey,
  type ReviewStatus,
  type StageSubmissionInput,
} from "@/domain/competition-line";

// Final review IMPORTANT 1b：比賽那一列讀不到（RLS 擋掉、資料不一致）時顯示這句，不畫燈、
// 不捏造截止日。
export const COMPETITION_UNREADABLE = "比賽資料無法讀取";

export type MyGroupEntry = {
  entryId: string;
  competitionName: string;
  status: EntryStatus;
};

// /my-group 頁的「比賽」區塊：這個組掛過的所有報名（含已退出的，狀態顯示已退出）。用
// user-scoped client：read_entries 的 RLS（is_staff() or group_id in (select my_groups())）本來就會讓
// 這個組的學生看到自己組的報名，不需要 service client。
export async function loadMyGroupEntries(): Promise<MyGroupEntry[]> {
  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "student" || !access.active.groupId) return [];

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("competition_entries")
    .select("id, confirmed_at, withdrawn_at, competitions(name)")
    .eq("group_id", access.active.groupId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const competition = row.competitions as unknown as { name: string } | { name: string }[] | null;
    const name = Array.isArray(competition) ? competition[0]?.name : competition?.name;
    return {
      entryId: row.id as string,
      competitionName: name ?? COMPETITION_UNREADABLE,
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
  result: "advanced" | "awarded" | "not_selected" | null;
  groupStudents: { id: string; name: string }[];
  selectedMemberIds: string[];
  // controller ruling（fix round 1）：學生確認報名之後如果換組，entry_members 裡那筆紀錄留著
  // （不刪）；顯示的時候要標成「已換組」，不能直接消失——不然看起來像這個人從沒參加過。
  // movedOut = 這個 member 現在的 group_id 已經不是這筆報名的組。
  // left = 這個身份已離開（Task 7）：照樣列出，顯示「姓名（已離開）」，但不能再勾。
  selectedMembers: { id: string; name: string; movedOut: boolean; left: boolean }[];
  // lineId：確認報名之後才會有比賽線（見 confirm_entry()），確認前一律 null，這時候也不會有
  // stages／submissions（沒有線就沒有階段可以上傳）。
  lineId: string | null;
  stages: Stage[];
  submissions: StageSubmission[];
};

export type StageSubmission = {
  id: string;
  stage: StageKey;
  version: number;
  reviewStatus: ReviewStatus;
  pdfUploadedAt: string; // ISO
  comment: string | null;
};

// 報名頁（/my-group/competitions/[entryId]）：找不到（不是這組的、id 亂填、根本不存在）一律
// 回傳 null，呼叫端轉成 404，不透露「這筆報名存在，只是不是你的組」。
export async function loadEntryDetail(entryId: string): Promise<EntryDetail | null> {
  if (!isUuid(entryId)) return null;

  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "student" || !access.active.groupId) {
    return null;
  }

  const groupId = access.active.groupId;

  const supabase = await createServerSupabase();
  const { data: entry, error } = await supabase
    .from("competition_entries")
    .select(
      "id, confirmed_at, withdrawn_at, group_id, result, competitions(name, url, signup_deadline, submission_deadline, final_date)"
    )
    .eq("id", entryId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) throw error;
  if (!entry) return null;

  type CompetitionRow = {
    name: string;
    url: string;
    signup_deadline: string;
    submission_deadline: string | null;
    final_date: string | null;
  };
  const competition = entry.competitions as unknown as CompetitionRow | CompetitionRow[] | null;
  const competitionRow = Array.isArray(competition) ? competition[0] : competition;

  const { data: students, error: studentsError } = await supabase
    .from("members")
    .select("id, name")
    .eq("group_id", groupId)
    .eq("role", "student")
    // Task 7：已離開的人不能再被勾成參賽成員。
    .is("left_at", null)
    .order("name");
  if (studentsError) throw studentsError;

  const { data: selected, error: selectedError } = await supabase
    .from("entry_members")
    .select("member_id")
    .eq("entry_id", entryId);
  if (selectedError) throw selectedError;
  const selectedMemberIds = (selected ?? []).map((s) => s.member_id as string);

  // 已經選過的成員可能換組了：這組的學生（read_members 的 RLS）看不到別組成員現在的 member
  // 列（group_id 已經不在 my_groups() 裡），所以這裡用 service client 單獨查這幾個 id 的
  // 名字／目前的 group_id——只回傳名字跟「有沒有換組」，不會多洩漏其他資訊。
  let selectedMembers: { id: string; name: string; movedOut: boolean; left: boolean }[] = [];
  if (selectedMemberIds.length > 0) {
    const service = createServiceSupabase();
    const { data: memberRows, error: memberError } = await service
      .from("members")
      .select("id, name, group_id, left_at")
      .in("id", selectedMemberIds);
    if (memberError) throw memberError;
    const byId = new Map((memberRows ?? []).map((m) => [m.id as string, m]));
    selectedMembers = selectedMemberIds.map((id) => {
      const row = byId.get(id);
      return {
        id,
        name: (row?.name as string | undefined) ?? "",
        movedOut: (row?.group_id as string | null | undefined) !== groupId,
        left: !!row?.left_at,
      };
    });
  }

  const confirmedAt = entry.confirmed_at ? new Date(entry.confirmed_at as string) : null;
  const withdrawnAt = entry.withdrawn_at ? new Date(entry.withdrawn_at as string) : null;

  // lineId／stages／submissions：確認報名之後才會有比賽線（confirm_entry() 才會 insert
  // 一列 kind='competition' 的 lines）——確認前這裡維持空陣列／null，UI 不畫階段上傳區塊。
  let lineId: string | null = null;
  let stages: Stage[] = [];
  let submissions: StageSubmission[] = [];

  if (confirmedAt && competitionRow) {
    const { data: lineRow, error: lineError } = await supabase
      .from("lines")
      .select("id")
      .eq("entry_id", entryId)
      .eq("kind", "competition")
      .maybeSingle();
    if (lineError) throw lineError;
    lineId = (lineRow?.id as string | undefined) ?? null;

    if (lineId) {
      const { data: subRows, error: subError } = await supabase
        .from("stage_submissions")
        .select("id, stage, version, review_status, pdf_uploaded_at, comment")
        .eq("line_id", lineId)
        .order("stage")
        .order("version");
      if (subError) throw subError;

      submissions = (subRows ?? []).map((s) => ({
        id: s.id as string,
        stage: s.stage as StageKey,
        version: s.version as number,
        reviewStatus: s.review_status as ReviewStatus,
        pdfUploadedAt: s.pdf_uploaded_at as string,
        comment: s.comment as string | null,
      }));

      const submissionInputs: StageSubmissionInput[] = submissions.map((s) => ({
        stage: s.stage,
        version: s.version,
        pdfUploadedAt: new Date(s.pdfUploadedAt),
        reviewStatus: s.reviewStatus,
      }));

      stages = competitionStages(
        {
          signupDeadline: new Date(competitionRow.signup_deadline),
          submissionDeadline: competitionRow.submission_deadline ? new Date(competitionRow.submission_deadline) : null,
          finalDate: competitionRow.final_date ? new Date(competitionRow.final_date) : null,
        },
        { confirmedAt, withdrawnAt, result: entry.result as "advanced" | "awarded" | "not_selected" | null },
        submissionInputs,
        new Date()
      );
    }
  }

  return {
    entryId: entry.id as string,
    competitionName: competitionRow?.name ?? COMPETITION_UNREADABLE,
    competitionUrl: competitionRow?.url ?? "",
    confirmedAt,
    withdrawnAt,
    result: entry.result as "advanced" | "awarded" | "not_selected" | null,
    status: entryStatus({ confirmedAt, withdrawnAt }),
    groupStudents: (students ?? []).map((s) => ({ id: s.id as string, name: s.name as string })),
    selectedMemberIds,
    selectedMembers,
    lineId,
    stages,
    submissions,
  };
}
