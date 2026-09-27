"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { isUuid } from "@/domain/id";
import type { Access } from "@/domain/access";

const NOT_FOUND = "找不到這筆報名";
const COMPETITION_NOT_FOUND = "找不到這場比賽";
const ALREADY_ATTACHED = "這場比賽已經掛在你們組了";
const DEADLINE_PASSED = "已經過了報名截止日";
const NEED_MEMBER = "請至少勾選一位參賽成員";
const ALREADY_CONFIRMED = "已經確認報名，不能再改參賽成員以外的設定";
const STUDENT_ONLY = "只有專案生可以操作比賽報名";

type OkAccess = Extract<Access, { kind: "ok" }>;
type StudentAccess = OkAccess & { member: NonNullable<OkAccess["member"]> & { groupId: string } };

// 掛比賽／參賽成員／確認報名／取消報名一律只有「該組專案生」能做（規格第 3 節）；別組學生、
// 幹部（包含管理員本人如果掛了幹部角色）都不符合這個條件。onReject 決定「不是這組專案生」
// 時回什麼錯誤：attachCompetition 沒有既存的 entryId 可以核對，回一個獨立的訊息；
// setEntryMembers／confirmEntry／withdrawEntry 已經有 entryId，跟「別組的報名」統一回
// 找不到這筆報名（規格第 3 節：別組學生、幹部不能對這組做這些動作）。
async function requireStudent(
  onReject: string = STUDENT_ONLY
): Promise<{ ok: true; access: StudentAccess } | { ok: false; error: string }> {
  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return { ok: false, error: onReject };
  }
  return { ok: true, access: access as StudentAccess };
}

type Db = ReturnType<typeof createServiceSupabase>;

// 找這筆報名，且必須屬於呼叫者的組——別組的報名、亂填的 id、根本不存在的 id 一律回傳
// 找不到這筆報名，不透露「這筆報名存在，只是不是你的組」。
async function findOwnEntry(
  db: Db,
  entryId: string,
  groupId: string
): Promise<{ id: string; group_id: string; competition_id: string; confirmed_at: string | null; withdrawn_at: string | null } | null> {
  if (!isUuid(entryId)) return null;
  const { data, error } = await db
    .from("competition_entries")
    .select("id, group_id, competition_id, confirmed_at, withdrawn_at")
    .eq("id", entryId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) throw error;
  return data as {
    id: string;
    group_id: string;
    competition_id: string;
    confirmed_at: string | null;
    withdrawn_at: string | null;
  } | null;
}

// 學生把已發布、當前學期、還沒過報名截止日的比賽掛到自己組。草稿或別學期的卡片一律當「找不到
// 這場比賽」（不透露「這場比賽存在，只是還沒發布／不是這學期」）。
export async function attachCompetition(
  competitionId: string
): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  const guard = await requireStudent();
  if (!guard.ok) return guard;
  const { access } = guard;

  if (!isUuid(competitionId)) return { ok: false, error: COMPETITION_NOT_FOUND };

  const db = createServiceSupabase();
  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .select("id, signup_deadline")
    .eq("id", competitionId)
    .eq("semester_id", access.semesterId)
    .eq("status", "published")
    .maybeSingle();
  if (competitionError) throw competitionError;
  if (!competition) return { ok: false, error: COMPETITION_NOT_FOUND };

  if (new Date(competition.signup_deadline as string).getTime() < Date.now()) {
    return { ok: false, error: DEADLINE_PASSED };
  }

  const { data: existing, error: existingError } = await db
    .from("competition_entries")
    .select("id")
    .eq("group_id", access.member.groupId)
    .eq("competition_id", competitionId)
    .is("withdrawn_at", null)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { ok: false, error: ALREADY_ATTACHED };

  const { data: inserted, error: insertError } = await db
    .from("competition_entries")
    .insert({ group_id: access.member.groupId, competition_id: competitionId, created_by: access.email })
    .select("id")
    .single();
  if (insertError) {
    // 部分唯一索引（group_id, competition_id) where withdrawn_at is null）擋下的併發重複掛：
    // 兩個請求同時通過上面「查有沒有existing」的檢查，其中一個 insert 先成功、另一個撞唯一
    // 索引違規（23505），一樣回傳「已經掛在你們組了」，不是未處理的例外。
    if ((insertError as { code?: string }).code === "23505") return { ok: false, error: ALREADY_ATTACHED };
    throw insertError;
  }

  revalidatePath("/competitions");
  revalidatePath("/my-group");
  return { ok: true, entryId: inserted.id as string };
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// 確認報名前可以先存參賽成員名單；只能勾自己組的專案生，至少要有一人。確認報名後不能再用
// 這個動作改參賽成員（要改的話只能透過還沒實作的別的流程；批次 3 範圍外）。
export async function setEntryMembers(
  entryId: string,
  memberIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireStudent(NOT_FOUND);
  if (!guard.ok) return guard;
  const { access } = guard;

  const db = createServiceSupabase();
  const entry = await findOwnEntry(db, entryId, access.member.groupId);
  if (!entry) return { ok: false, error: NOT_FOUND };
  if (entry.withdrawn_at) return { ok: false, error: NOT_FOUND };
  if (entry.confirmed_at) return { ok: false, error: ALREADY_CONFIRMED };

  const ids = dedupe(memberIds);
  if (ids.length === 0) return { ok: false, error: NEED_MEMBER };

  const { count, error: countError } = await db
    .from("members")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .eq("role", "student")
    .eq("group_id", access.member.groupId);
  if (countError) throw countError;
  if ((count ?? 0) !== ids.length) return { ok: false, error: NEED_MEMBER };

  const { error: deleteError } = await db.from("entry_members").delete().eq("entry_id", entryId);
  if (deleteError) throw deleteError;
  const { error: insertError } = await db
    .from("entry_members")
    .insert(ids.map((memberId) => ({ entry_id: entryId, member_id: memberId })));
  if (insertError) throw insertError;

  revalidatePath(`/my-group/competitions/${entryId}`);
  return { ok: true };
}

// 確認報名：實際的原子檢查與寫入都在 confirm_entry()（SQL 函式，service_role 專用）裡，
// 這裡先做一次同樣的檢查讓錯誤訊息回得快，函式裡的檢查是最後一道防線（見 controller ruling）。
export async function confirmEntry(
  entryId: string,
  memberIds: string[]
): Promise<{ ok: true; lineId: string } | { ok: false; error: string }> {
  const guard = await requireStudent(NOT_FOUND);
  if (!guard.ok) return guard;
  const { access } = guard;

  const db = createServiceSupabase();
  const entry = await findOwnEntry(db, entryId, access.member.groupId);
  if (!entry) return { ok: false, error: NOT_FOUND };
  if (entry.withdrawn_at) return { ok: false, error: NOT_FOUND };
  if (entry.confirmed_at) return { ok: false, error: ALREADY_CONFIRMED };

  const ids = dedupe(memberIds);
  if (ids.length === 0) return { ok: false, error: NEED_MEMBER };

  const { data, error } = await db.rpc("confirm_entry", { p_entry_id: entryId, p_member_ids: ids });
  if (error) {
    const message = error.message ?? "";
    if (message.includes(NOT_FOUND)) return { ok: false, error: NOT_FOUND };
    if (message.includes(NEED_MEMBER)) return { ok: false, error: NEED_MEMBER };
    if (message.includes("已經確認過了") || message.includes("已經退出")) return { ok: false, error: ALREADY_CONFIRMED };
    if (message.includes("必須是同一組的專案生")) return { ok: false, error: NEED_MEMBER };
    throw error;
  }

  revalidatePath(`/my-group/competitions/${entryId}`);
  revalidatePath("/my-group");
  return { ok: true, lineId: data as string };
}

// 取消報名：已確認過的（有 confirmed_at）標成 withdrawn_at，比賽線留著（停止判燈是 Task 4 的
// 事），檔案與審核紀錄保留；取消後可以重新掛同一場（下一次 attachCompetition 會是新的一筆
// row，部分唯一索引只擋「未退出」的重複）。還沒確認過的報名，取消等於整筆刪除（controller
// ruling：把未確認的取消當「移除」）。
export async function withdrawEntry(entryId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireStudent(NOT_FOUND);
  if (!guard.ok) return guard;
  const { access } = guard;

  const db = createServiceSupabase();
  const entry = await findOwnEntry(db, entryId, access.member.groupId);
  if (!entry) return { ok: false, error: NOT_FOUND };
  if (entry.withdrawn_at) return { ok: false, error: NOT_FOUND };

  if (entry.confirmed_at) {
    const { error } = await db
      .from("competition_entries")
      .update({ withdrawn_at: new Date().toISOString() })
      .eq("id", entryId);
    if (error) throw error;
  } else {
    const { error } = await db.from("competition_entries").delete().eq("id", entryId);
    if (error) throw error;
  }

  revalidatePath(`/my-group/competitions/${entryId}`);
  revalidatePath("/my-group");
  revalidatePath("/competitions");
  return { ok: true };
}
