"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { parseRosterCsv } from "@/domain/roster-csv";
import { parseTaipeiDeadline } from "@/domain/time";

async function requireAdmin(): Promise<void> {
  const access = await getAccess();
  // kind 可能是 "no_semester"：建立第一個學期（createSemester）就是在還沒有任何學期時呼叫的，
  // 這時 access.kind 必然是 "no_semester"，不能只接受 "ok"。wrong_domain／not_in_roster
  // 這兩種 kind 沒有 isAdmin 欄位（一定不是管理員），所以先排除掉它們。
  const isAdmin = (access.kind === "ok" || access.kind === "no_semester") && access.isAdmin;
  if (!isAdmin) {
    throw new Error("只有系統管理員可以這樣做");
  }
}

export async function createSemester(name: string): Promise<{ semesterId: string }> {
  await requireAdmin();
  const db = createServiceSupabase();

  // one_current_semester 這個 partial unique index 只允許同時有一個 is_current=true 的學期，
  // 所以要先把其他學期設成 false，再插入新學期並設成 true，順序不能反過來。
  const { error: clearError } = await db.from("semesters").update({ is_current: false }).eq("is_current", true);
  if (clearError) throw clearError;

  const { data, error } = await db.from("semesters").insert({ name, is_current: true }).select("id").single();
  if (error) throw error;

  revalidatePath("/admin");
  return { semesterId: data.id as string };
}

export async function importRoster(
  semesterId: string,
  csv: string
): Promise<{ ok: true; imported: number } | { ok: false; errors: string[] }> {
  await requireAdmin();
  const db = createServiceSupabase();

  const { count } = await db.from("members").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
  if (count && count > 0) {
    return { ok: false, errors: ["本學期已匯入名單；學期中的異動請用「換組」」"] };
  }

  const parsed = parseRosterCsv(csv);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { error } = await db.rpc("import_roster", { p_semester_id: semesterId, rows: parsed.rows });
  if (error) return { ok: false, errors: [error.message] };

  revalidatePath("/admin");
  return { ok: true, imported: parsed.rows.length };
}

export async function savePeriods(
  semesterId: string,
  rows: { date: string; time: string }[]
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  await requireAdmin();
  const db = createServiceSupabase();

  const parsedDeadlines: { i: number; deadline: Date }[] = [];
  const errors: string[] = [];
  rows.forEach((r, idx) => {
    const n = idx + 1;
    try {
      parsedDeadlines.push({ i: n, deadline: parseTaipeiDeadline(r.date, r.time) });
    } catch {
      errors.push(`第 ${n} 列：日期或時間格式錯誤`);
    }
  });

  // 找重複截止時間：對每個時間戳只保留第一次出現的列號，之後每一次重複都各自報一次錯，
  // 訊息裡的 M 是「和它重複的、列號較小的那一列」。
  const seenAt = new Map<number, number>();
  for (const { i, deadline } of parsedDeadlines) {
    const t = deadline.getTime();
    const prev = seenAt.get(t);
    if (prev !== undefined) {
      errors.push(`第 ${i} 列：和第 ${prev} 列的截止時間重複`);
    } else {
      seenAt.set(t, i);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // 已經有組別交了進度（progress_reports 參照這個學期的期別）就不能再改期別。
  const { data: periodRows } = await db.from("periods").select("id").eq("semester_id", semesterId);
  const periodIds = (periodRows ?? []).map((p) => p.id as string);
  if (periodIds.length > 0) {
    const { count: reportCount } = await db
      .from("progress_reports")
      .select("id", { count: "exact", head: true })
      .in("period_id", periodIds);
    if (reportCount && reportCount > 0) {
      return { ok: false, errors: ["已經有組別交了進度，不能再改期別"] };
    }
  }

  const sorted = [...parsedDeadlines].sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  const { error: delError } = await db.from("periods").delete().eq("semester_id", semesterId);
  if (delError) throw delError;

  if (sorted.length > 0) {
    const { error: insError } = await db.from("periods").insert(
      sorted.map((s, idx) => ({ semester_id: semesterId, seq: idx + 1, deadline: s.deadline.toISOString() }))
    );
    if (insError) throw insError;
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function setPmGroups(pmMemberId: string, groupIds: string[]): Promise<void> {
  await requireAdmin();
  const db = createServiceSupabase();

  const { data: pm, error: pmError } = await db.from("members").select("role").eq("id", pmMemberId).single();
  if (pmError) throw pmError;
  if (pm.role !== "pm") throw new Error("只有專案幹部才能負責組別");

  const { error: delError } = await db.from("pm_assignments").delete().eq("pm_member_id", pmMemberId);
  if (delError) throw delError;

  if (groupIds.length > 0) {
    const { error: insError } = await db
      .from("pm_assignments")
      .insert(groupIds.map((groupId) => ({ pm_member_id: pmMemberId, group_id: groupId })));
    if (insError) throw insError;
  }

  revalidatePath("/admin");
}

export async function setRedAfterHours(semesterId: string, hours: number): Promise<void> {
  await requireAdmin();
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
    throw new Error("紅燈門檻必須是 1 到 720 之間的整數小時");
  }
  const db = createServiceSupabase();
  const { error } = await db.from("semesters").update({ red_after_hours: hours }).eq("id", semesterId);
  if (error) throw error;

  revalidatePath("/admin");
}

export async function moveMember(memberId: string, toGroupId: string): Promise<void> {
  await requireAdmin();
  const db = createServiceSupabase();

  const { data: member, error: memberError } = await db
    .from("members")
    .select("role, semester_id")
    .eq("id", memberId)
    .single();
  if (memberError) throw memberError;
  if (member.role !== "student") throw new Error("只有專案生可以換組");

  const { data: group, error: groupError } = await db.from("groups").select("semester_id").eq("id", toGroupId).single();
  if (groupError) throw groupError;
  if (group.semester_id !== member.semester_id) throw new Error("目標組別必須在同一個學期");

  const { error } = await db.from("members").update({ group_id: toGroupId }).eq("id", memberId);
  if (error) throw error;

  revalidatePath("/admin");
}
