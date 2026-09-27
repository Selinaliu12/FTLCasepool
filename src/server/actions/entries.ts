"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { acknowledgementRequired } from "@/server/queries/acknowledgement";
import { createServiceSupabase } from "@/server/supabase";
import { isUuid } from "@/domain/id";
import type { StudentAccess } from "@/domain/access";

const NOT_FOUND = "找不到這筆報名";
const COMPETITION_NOT_FOUND = "找不到這場比賽";
const ALREADY_ATTACHED = "這場比賽已經掛在你們組了";
const DEADLINE_PASSED = "已經過了報名截止日";
const NEED_MEMBER = "請至少勾選一位參賽成員";
const WRONG_GROUP_MEMBER = "只能勾選自己組的專案生";
const ALREADY_CONFIRMED = "這筆報名已經確認過了";
const STUDENT_ONLY = "只有專案生可以操作比賽報名";
const SIGNUP_NOT_APPROVED = "報名通過後才能填比賽結果";

const RESULT_VALUES = ["advanced", "awarded", "not_selected"] as const;
type EntryResult = (typeof RESULT_VALUES)[number] | null;

// 掛比賽／參賽成員／確認報名／取消報名一律只有「該組專案生」能做（規格第 3 節）；別組學生、
// 幹部（包含管理員本人如果掛了幹部角色）都不符合這個條件。onReject 決定「不是這組專案生」
// 時回什麼錯誤：attachCompetition 沒有既存的 entryId 可以核對，回一個獨立的訊息；
// setEntryMembers／confirmEntry／withdrawEntry 已經有 entryId，跟「別組的報名」統一回
// 找不到這筆報名（規格第 3 節：別組學生、幹部不能對這組做這些動作）。
async function requireStudent(
  onReject: string = STUDENT_ONLY
): Promise<{ ok: true; access: StudentAccess } | { ok: false; error: string }> {
  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "student" || !access.active.groupId) {
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
  const notAcknowledged = await acknowledgementRequired(access.semesterId, access.email);
  if (notAcknowledged) return notAcknowledged;

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
    .eq("group_id", access.active.groupId)
    .eq("competition_id", competitionId)
    .is("withdrawn_at", null)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { ok: false, error: ALREADY_ATTACHED };

  const { data: inserted, error: insertError } = await db
    .from("competition_entries")
    .insert({ group_id: access.active.groupId, competition_id: competitionId, created_by: access.email })
    .select("id")
    .single();
  if (insertError) {
    // 部分唯一索引（group_id, competition_id) where withdrawn_at is null）擋下的併發重複掛：
    // 兩個請求同時通過上面「查有沒有existing」的檢查，其中一個 insert 先成功、另一個撞唯一
    // 索引違規（23505），一樣回傳「已經掛在你們組了」，不是未處理的例外（見
    // tests/integration/entries-actions.test.ts 的併發測試）。
    if ((insertError as { code?: string }).code === "23505") return { ok: false, error: ALREADY_ATTACHED };
    // 上面讀到 published 之後、insert 之前比賽剛好被取消發布：competition_entries 的 insert
    // trigger（20260927000019_batch2_final_fixes.sql）擋下，跟草稿一樣當「找不到這場比賽」。
    if (insertError.message === "competition_not_published") return { ok: false, error: COMPETITION_NOT_FOUND };
    throw insertError;
  }

  revalidatePath("/competitions");
  revalidatePath("/my-group");
  return { ok: true, entryId: inserted.id as string };
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// RPC（confirm_entry／update_entry_members）拋出的例外訊息 → 回給前端的錯誤訊息。兩個函式的
// member 檢查訊息已經統一成同一句話（見 20260927000013_entry_members.sql），這裡共用同一個
// 對照表，不用在 confirmEntry／setEntryMembers 各寫一份。
function mapRpcError(message: string): string | null {
  if (message.includes(NOT_FOUND)) return NOT_FOUND;
  if (message.includes(NEED_MEMBER)) return NEED_MEMBER;
  if (message.includes(WRONG_GROUP_MEMBER)) return WRONG_GROUP_MEMBER;
  if (message.includes(ALREADY_CONFIRMED)) return ALREADY_CONFIRMED;
  // 「已經退出」：update_entry_members() 在報名退出後拒絕改成員；findOwnEntry() 已經先擋過
  // withdrawn_at 的情況，這裡是併發時的最後一道防線（在我們讀到「還沒退出」之後、真的呼叫
  // RPC 之前，剛好被取消報名搶先了），一律當「找不到這筆報名」（跟其他「別組／已退出」的
  // 情況統一，不透露「這筆報名存在過」）。
  if (message.includes("已經退出")) return NOT_FOUND;
  return null;
}

// 參賽成員：確認前後都可以改，只要這筆報名還沒退出（規格：「確認後不能再改參賽成員以外的
// 設定」——參賽成員本身不在「以外」，是可以改的）。只能勾自己組的專案生，至少要有一人。
// 實際的原子檢查與寫入都在 update_entry_members()（SQL 函式，service_role 專用）裡。
export async function setEntryMembers(
  entryId: string,
  memberIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireStudent(NOT_FOUND);
  if (!guard.ok) return guard;
  const { access } = guard;
  const notAcknowledged = await acknowledgementRequired(access.semesterId, access.email);
  if (notAcknowledged) return notAcknowledged;

  const db = createServiceSupabase();
  const entry = await findOwnEntry(db, entryId, access.active.groupId);
  if (!entry) return { ok: false, error: NOT_FOUND };
  if (entry.withdrawn_at) return { ok: false, error: NOT_FOUND };

  const ids = dedupe(memberIds);
  if (ids.length === 0) return { ok: false, error: NEED_MEMBER };

  const { error } = await db.rpc("update_entry_members", { p_entry_id: entryId, p_member_ids: ids });
  if (error) {
    const mapped = mapRpcError(error.message ?? "");
    if (mapped) return { ok: false, error: mapped };
    throw error;
  }

  revalidatePath(`/my-group/competitions/${entryId}`);
  revalidatePath("/my-group");
  return { ok: true };
}

// 確認報名：實際的原子檢查與寫入都在 confirm_entry()（SQL 函式，service_role 專用）裡，
// 這裡先做一次同樣的檢查讓錯誤訊息回得快，函式裡的檢查是最後一道防線（見 controller ruling）。
// controller ruling（fix round 1）：報名截止日不擋確認報名——組上可能已經在官方管道報過名，
// 只是這裡確認得比較晚；這裡跟 confirm_entry() 都刻意不檢查 signup_deadline。
export async function confirmEntry(
  entryId: string,
  memberIds: string[]
): Promise<{ ok: true; lineId: string } | { ok: false; error: string }> {
  const guard = await requireStudent(NOT_FOUND);
  if (!guard.ok) return guard;
  const { access } = guard;
  const notAcknowledged = await acknowledgementRequired(access.semesterId, access.email);
  if (notAcknowledged) return notAcknowledged;

  const db = createServiceSupabase();
  const entry = await findOwnEntry(db, entryId, access.active.groupId);
  if (!entry) return { ok: false, error: NOT_FOUND };
  if (entry.withdrawn_at) return { ok: false, error: NOT_FOUND };
  if (entry.confirmed_at) return { ok: false, error: ALREADY_CONFIRMED };

  const ids = dedupe(memberIds);
  if (ids.length === 0) return { ok: false, error: NEED_MEMBER };

  const { data, error } = await db.rpc("confirm_entry", { p_entry_id: entryId, p_member_ids: ids });
  if (error) {
    const mapped = mapRpcError(error.message ?? "");
    if (mapped) return { ok: false, error: mapped };
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
  const notAcknowledged = await acknowledgementRequired(access.semesterId, access.email);
  if (notAcknowledged) return notAcknowledged;

  const db = createServiceSupabase();
  const entry = await findOwnEntry(db, entryId, access.active.groupId);
  if (!entry) return { ok: false, error: NOT_FOUND };
  if (entry.withdrawn_at) return { ok: false, error: NOT_FOUND };

  if (!entry.confirmed_at) {
    // Fix round 1（controller ruling 4）：加 .is("confirmed_at", null) 防止跟 confirmEntry()
    // 的競態——如果在我們讀到「還沒確認」之後、這個 delete 真的送出之前，這筆報名剛好被搶先
    // 確認了（confirmed_at 變成 not null，同時已經插入一條 lines 外鍵指到這筆報名），沒有這個
    // 條件的 delete 會撞 lines.entry_id 的外鍵，變成未處理的例外（500）。加了這個條件之後，
    // 這次 delete 只會影響 0 筆，往下走到「已確認」分支，改成標記 withdrawn_at。
    const { data: deleted, error } = await db
      .from("competition_entries")
      .delete()
      .eq("id", entryId)
      .is("confirmed_at", null)
      .select("id");
    if (error) throw error;
    if ((deleted ?? []).length > 0) {
      revalidatePath(`/my-group/competitions/${entryId}`);
      revalidatePath("/my-group");
      revalidatePath("/competitions");
      return { ok: true };
    }
  }

  // Minor 7（fix round 1）：加 .is("withdrawn_at", null) 防止兩個同時送出的取消報名都「成功」
  // ——比較晚寫入的那個 update 會影響 0 筆，回傳找不到這筆報名，不是誤以為自己也成功退出了。
  const { data: updated, error } = await db
    .from("competition_entries")
    .update({ withdrawn_at: new Date().toISOString() })
    .eq("id", entryId)
    .is("withdrawn_at", null)
    .select("id");
  if (error) throw error;
  if ((updated ?? []).length === 0) return { ok: false, error: NOT_FOUND };

  revalidatePath(`/my-group/competitions/${entryId}`);
  revalidatePath("/my-group");
  revalidatePath("/competitions");
  return { ok: true };
}

// 比賽結果：組員可以任意次更正（包含改回 null／尚未公布），效果（結束線、決賽仍必要、
// 重新開放已結束的線）全部交給既有的純函式（isLineEnded／competitionStages／
// competitionStatus，見 src/domain/competition-line.ts）處理——這裡只負責原子地寫入
// competition_entries.result，並且套用跟其他比賽動作一致的權限（只有這組專案生、已按過
// 我已了解）與統一錯誤訊息（別組、亂填的 id、報名還沒確認、已經退出，全部回「找不到這筆
// 報名」，不透露細節）。
//
// controller ruling 1：用條件式 update（confirmed_at is not null and withdrawn_at is null）
// 而不是先讀一次再判斷——影響 0 筆的時候回 NOT_FOUND，避免「先讀到還沒退出、真的寫入之前
// 剛好被取消報名搶先」這種時間窗留下不一致的狀態（跟 withdrawEntry() 的併發防護同一個模式）。
export async function setResult(
  entryId: string,
  result: EntryResult
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireStudent(NOT_FOUND);
  if (!guard.ok) return guard;
  const { access } = guard;
  const notAcknowledged = await acknowledgementRequired(access.semesterId, access.email);
  if (notAcknowledged) return notAcknowledged;

  if (!isUuid(entryId)) return { ok: false, error: NOT_FOUND };
  if (result !== null && !(RESULT_VALUES as readonly string[]).includes(result)) {
    return { ok: false, error: NOT_FOUND };
  }

  const db = createServiceSupabase();

  // Final review minor 3（controller ruling；計畫 Task 7「組員可在已報名後填結果」）：填入
  // 晉級／得獎／未入選之前，報名階段必須已經通過。清回 null（尚未公布）一律允許——舊資料如果
  // 已經有結果，組員還是能更正回去。先確認這筆報名屬於這組、已確認、沒退出（不然回
  // NOT_FOUND，不透露別組報名階段的狀態），再看報名階段有沒有通過。「通過」是單向的
  // （review_stage() 只從 pending 改、withdraw_stage 只刪 pending、鎖定後不能改），所以這個
  // 先讀後寫不會有「讀到通過、寫入前又變回沒通過」的時間窗；下面的條件式 update 仍然守住
  // 「已確認、沒退出」。
  if (result !== null) {
    const { data: own, error: ownError } = await db
      .from("competition_entries")
      .select("id")
      .eq("id", entryId)
      .eq("group_id", access.active.groupId)
      .not("confirmed_at", "is", null)
      .is("withdrawn_at", null)
      .maybeSingle();
    if (ownError) throw ownError;
    if (!own) return { ok: false, error: NOT_FOUND };

    const { data: line, error: lineError } = await db
      .from("lines")
      .select("id")
      .eq("entry_id", entryId)
      .eq("kind", "competition")
      .maybeSingle();
    if (lineError) throw lineError;
    if (!line) return { ok: false, error: SIGNUP_NOT_APPROVED };

    const { data: approved, error: approvedError } = await db
      .from("stage_submissions")
      .select("id")
      .eq("line_id", line.id as string)
      .eq("stage", "signup")
      .eq("review_status", "approved")
      .limit(1);
    if (approvedError) throw approvedError;
    if ((approved ?? []).length === 0) return { ok: false, error: SIGNUP_NOT_APPROVED };
  }

  const { data: updated, error } = await db
    .from("competition_entries")
    .update({ result })
    .eq("id", entryId)
    .eq("group_id", access.active.groupId)
    .not("confirmed_at", "is", null)
    .is("withdrawn_at", null)
    .select("id");
  if (error) throw error;
  if ((updated ?? []).length === 0) return { ok: false, error: NOT_FOUND };

  revalidatePath(`/my-group/competitions/${entryId}`);
  revalidatePath("/my-group");
  revalidatePath("/competitions");
  return { ok: true };
}
