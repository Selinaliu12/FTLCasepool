import "server-only";
import { getAccess } from "@/server/session";
import { createServerSupabase } from "@/server/supabase";
import { isLocked } from "@/domain/lock";
import { daysUntil } from "@/domain/time";
import { STAGE_LABEL, isLineEnded, type StageKey, type EntryResult } from "@/domain/competition-line";

export type ReviewQueueItem = {
  submissionId: string;
  groupId: string;
  groupName: string;
  competitionName: string;
  stage: StageKey;
  stageLabel: string;
  version: number;
  uploadedAt: Date;
  waitingDays: number;
  href: string;
};

// 「待你審核」：只有目前這位專案幹部負責的組別、已鎖定、待審、最新一版、且線還沒結束的繳交。
// 用 user-scoped client——stage_submissions 的 read policy（can_read_content：is_pm() or 自己組）
// 讓任何 PM 都讀得到內容，這裡再用 pm_assignments 把範圍縮到「負責的組」，跟 reviewStage()
// 的權限檢查同一份資料來源、同一個當下查詢（不快取），換組後下一次呼叫立刻反映（Review Focus 4）。
// 非專案幹部（含管理員、其他幹部、學生）一律回空陣列。
export async function loadReviewQueue(now: Date = new Date()): Promise<ReviewQueueItem[]> {
  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "pm") return [];

  const db = await createServerSupabase();

  const { data: assignments, error: assignError } = await db
    .from("pm_assignments")
    .select("group_id")
    .eq("pm_member_id", access.member.id);
  if (assignError) throw assignError;

  const groupIds = (assignments ?? []).map((a) => a.group_id as string);
  if (groupIds.length === 0) return [];

  const [groupsRes, linesRes] = await Promise.all([
    db.from("groups").select("id, name").in("id", groupIds),
    db.from("lines").select("id, group_id, entry_id").eq("kind", "competition").in("group_id", groupIds),
  ]);
  if (groupsRes.error) throw groupsRes.error;
  if (linesRes.error) throw linesRes.error;

  const lines = linesRes.data ?? [];
  if (lines.length === 0) return [];

  const groupNameById = new Map((groupsRes.data ?? []).map((g) => [g.id as string, g.name as string]));
  const lineIds = lines.map((l) => l.id as string);
  const entryIds = lines.map((l) => l.entry_id as string);

  const [entriesRes, submissionsRes] = await Promise.all([
    db
      .from("competition_entries")
      .select("id, withdrawn_at, result, competitions(name)")
      .in("id", entryIds),
    db
      .from("stage_submissions")
      .select("id, line_id, stage, version, pdf_uploaded_at, review_status")
      .in("line_id", lineIds)
      .eq("review_status", "pending"),
  ]);
  if (entriesRes.error) throw entriesRes.error;
  if (submissionsRes.error) throw submissionsRes.error;

  type EntryRow = { id: string; withdrawn_at: string | null; result: string | null; competitions: { name: string } | { name: string }[] | null };
  const entryById = new Map(((entriesRes.data ?? []) as EntryRow[]).map((e) => [e.id, e]));

  const lineInfoById = new Map(
    lines.map((l) => {
      const entry = entryById.get(l.entry_id as string);
      const competitionRaw = entry?.competitions ?? null;
      const competition = Array.isArray(competitionRaw) ? competitionRaw[0] : competitionRaw;
      // Final review minor 7：「線結束」一律用 isLineEnded（已退出，或結果是得獎／未入選），不在
      // 這裡另寫一份判斷。
      const ended =
        !!entry &&
        isLineEnded({
          confirmedAt: null,
          withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at) : null,
          result: entry.result as EntryResult,
        });
      return [
        l.id as string,
        { groupId: l.group_id as string, competitionName: competition?.name ?? "", ended },
      ];
    })
  );

  type SubmissionRow = { id: string; line_id: string; stage: string; version: number; pdf_uploaded_at: string; review_status: string };
  const submissions = (submissionsRes.data ?? []) as SubmissionRow[];

  // 「最新一版」：同一個 (line_id, stage) 底下 version 最大的那一筆——用 stage_submissions
  // 全表（不限 pending）比對太貴，這裡改用「這裡查到的 pending 版本」跟「同一 (line, stage)
  // 是否還有更大版號的 pending/approved/returned 版本」比較；因為部分唯一索引保證每個
  // (line, stage) 同時只有一筆 pending/approved，這裡查到的 pending 版本已經是目前活躍的
  // 那一筆，只要它的 version 是這個 (line, stage) 目前資料庫裡的最大值即可視為最新版
  // （比它大的版本不存在，因為活躍版本只有一筆，且退回重交一定遞增版號）。
  const maxVersionByLineStage = new Map<string, number>();
  {
    const allRes = await db.from("stage_submissions").select("line_id, stage, version").in("line_id", lineIds);
    if (allRes.error) throw allRes.error;
    for (const row of allRes.data ?? []) {
      const key = `${row.line_id}:${row.stage}`;
      const cur = maxVersionByLineStage.get(key) ?? 0;
      if ((row.version as number) > cur) maxVersionByLineStage.set(key, row.version as number);
    }
  }

  const items: ReviewQueueItem[] = [];
  for (const sub of submissions) {
    const info = lineInfoById.get(sub.line_id);
    if (!info || info.ended) continue;

    const key = `${sub.line_id}:${sub.stage}`;
    if (sub.version !== maxVersionByLineStage.get(key)) continue;

    const uploadedAt = new Date(sub.pdf_uploaded_at);
    if (!isLocked(uploadedAt, now)) continue;

    items.push({
      submissionId: sub.id,
      groupId: info.groupId,
      groupName: groupNameById.get(info.groupId) ?? "",
      competitionName: info.competitionName,
      stage: sub.stage as StageKey,
      stageLabel: STAGE_LABEL[sub.stage as StageKey],
      version: sub.version,
      uploadedAt,
      waitingDays: Math.max(0, daysUntil(now, uploadedAt)),
      href: `/groups/${info.groupId}`,
    });
  }

  items.sort((a, b) => b.waitingDays - a.waitingDays);
  return items;
}
