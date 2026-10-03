import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/server/supabase";
import { assignmentDeliverables } from "@/domain/assignment";
import type { Deliverable } from "@/domain/lights";
import { lockedAt } from "@/domain/lock";
import { compareNatural } from "@/domain/natural-sort";

// 作業（規格 §17）的狀態：每份作業派給哪些組、各組交了沒與繳交時間。只讀狀態欄位
// （assignments、assignment_groups、assignment_status 視圖），不讀繳交內容，所以所有幹部都能用；
// 專案生經 RLS 只讀得到派給自己組的。管理員傳服務身分。
export type AssignmentGroupStatus = { groupId: string; groupName: string; submittedAt: Date | null };

export type AssignmentSummary = {
  id: string;
  title: string;
  description: string | null;
  deadline: Date;
  createdById: string;
  createdByName: string;
  groups: AssignmentGroupStatus[];
};

export async function loadAssignments(
  db: SupabaseClient,
  semesterId: string,
  opts: { groupIds?: string[] } = {}
): Promise<AssignmentSummary[]> {
  const { data: assignments, error } = await db
    .from("assignments")
    .select("id, title, description, deadline, created_by")
    .eq("semester_id", semesterId)
    .order("deadline");
  if (error) throw error;
  if (!assignments || assignments.length === 0) return [];
  const ids = assignments.map((a) => a.id as string);

  let groupsQuery = db.from("assignment_groups").select("assignment_id, group_id").in("assignment_id", ids);
  if (opts.groupIds) groupsQuery = groupsQuery.in("group_id", opts.groupIds);
  // 出題者的名字：專案生的 RLS 讀不到幹部的名單列，名字本身不是內容，用服務身分只查這幾個 id 的姓名。
  const creatorIds = [...new Set(assignments.map((a) => a.created_by as string))];
  const [agRes, statusRes, groupNamesRes, { data: creators, error: creatorsError }] = await Promise.all([
    groupsQuery,
    db.from("assignment_status").select("assignment_id, group_id, pdf_uploaded_at").in("assignment_id", ids),
    db.from("groups").select("id, name").eq("semester_id", semesterId),
    createServiceSupabase().from("members").select("id, name").in("id", creatorIds),
  ]);
  if (agRes.error) throw agRes.error;
  if (statusRes.error) throw statusRes.error;
  if (groupNamesRes.error) throw groupNamesRes.error;
  if (creatorsError) throw creatorsError;

  const groupName = new Map((groupNamesRes.data ?? []).map((g) => [g.id as string, g.name as string]));
  const creatorName = new Map((creators ?? []).map((m) => [m.id as string, m.name as string]));
  const submittedAt = new Map(
    (statusRes.data ?? []).map((s) => [`${s.assignment_id}/${s.group_id}`, new Date(s.pdf_uploaded_at as string)])
  );

  return assignments
    .map((a) => {
      const groups = (agRes.data ?? [])
        .filter((ag) => ag.assignment_id === a.id && groupName.has(ag.group_id as string))
        .map((ag) => ({
          groupId: ag.group_id as string,
          groupName: groupName.get(ag.group_id as string) as string,
          submittedAt: submittedAt.get(`${a.id}/${ag.group_id}`) ?? null,
        }))
        .sort((x, y) => compareNatural(x.groupName, y.groupName));
      return {
        id: a.id as string,
        title: a.title as string,
        description: (a.description as string | null) ?? null,
        deadline: new Date(a.deadline as string),
        createdById: a.created_by as string,
        createdByName: creatorName.get(a.created_by as string) ?? "",
        groups,
      };
    })
    .filter((a) => a.groups.length > 0 || !opts.groupIds);
}

// 一組被派到的作業 → 專案線的交付項目（系統判定燈＋準時率，§17-6）。
export function assignmentDeliverablesForGroup(assignments: AssignmentSummary[], groupId: string): Deliverable[] {
  return assignmentDeliverables(
    assignments.flatMap((a) => {
      const g = a.groups.find((x) => x.groupId === groupId);
      return g ? [{ title: a.title, deadline: a.deadline, submittedAt: g.submittedAt }] : [];
    })
  );
}

// 一組的作業清單（/my-group 與 /groups/[id] 共用）：狀態人人有；content 只有 RLS 讓呼叫者讀得到
// 那份繳交時才有（該組組員、該組負責專案幹部、出題者、管理員的服務身分，§17-11）。
export type GroupAssignment = {
  id: string;
  title: string;
  description: string | null;
  deadline: Date;
  createdByName: string;
  submittedAt: Date | null;
  content: null | { submissionId: string; note: string | null; submittedBy: string; lockedAt: Date };
};

export async function loadGroupAssignments(
  db: SupabaseClient,
  semesterId: string,
  groupId: string,
  nameByEmail: Map<string, string>
): Promise<{ list: GroupAssignment[]; deliverables: Deliverable[] }> {
  // 兩個查詢互不依賴，一起發；繳交內容由 RLS 決定讀不讀得到（讀不到就只有狀態）。
  const [assignments, { data: submissions, error }] = await Promise.all([
    loadAssignments(db, semesterId, { groupIds: [groupId] }),
    db.from("assignment_submissions").select("id, assignment_id, note, submitted_by, pdf_uploaded_at").eq("group_id", groupId),
  ]);
  if (error) throw error;
  if (assignments.length === 0) return { list: [], deliverables: [] };
  const byAssignment = new Map((submissions ?? []).map((s) => [s.assignment_id as string, s]));

  const list = assignments.map((a) => {
    const status = a.groups.find((g) => g.groupId === groupId);
    const s = byAssignment.get(a.id);
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      deadline: a.deadline,
      createdByName: a.createdByName,
      submittedAt: status?.submittedAt ?? null,
      content: s
        ? {
            submissionId: s.id as string,
            note: (s.note as string | null) ?? null,
            submittedBy: nameByEmail.get(s.submitted_by as string) ?? (s.submitted_by as string),
            lockedAt: lockedAt(new Date(s.pdf_uploaded_at as string)),
          }
        : null,
    };
  });
  return { list, deliverables: assignmentDeliverablesForGroup(assignments, groupId) };
}
