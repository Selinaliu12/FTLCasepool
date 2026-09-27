"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { acknowledgementRequired } from "@/server/queries/acknowledgement";
import { createServiceSupabase } from "@/server/supabase";
import { isUuid } from "@/domain/id";
import { isLocked } from "@/domain/lock";
import { MAX_PDF_BYTES } from "@/domain/pdf";
import { inspectUploaded, deleteObject } from "@/server/r2";
import { isLineEnded, STAGE_KEYS, type StageKey } from "@/domain/competition-line";
import type { Access } from "@/domain/access";

const NOT_FOUND = "找不到這筆繳交";
const UPLOAD_FAILED = "檔案沒有上傳成功，請重新選擇 PDF";
const LOCKED_ERROR = "已超過 2 小時，已鎖定不能修改";
const ENDED_ERROR = "這場比賽已經結束，不能再上傳";
const STAGE_ACTIVE_ERROR = "這個階段已經交了，等審核結果或被退回後再重交";
const STALE_WRITE_ERROR = "這個階段的繳交剛剛被組員改過，請重新整理";

type OkAccess = Extract<Access, { kind: "ok" }>;
type StudentAccess = OkAccess & { member: NonNullable<OkAccess["member"]> & { groupId: string } };

// 只有「登入成功且是專案生且有 groupId」的呼叫者才可能通過後面的擁有權檢查；其他任何身分
// （幹部、PM、沒有組的專案生、根本沒登入）一律回統一的「找不到這筆繳交」，不透露這筆繳交
// 是不是存在（跟 progress.ts／entries.ts 的 requireStudent／callerContext 同一套模式）。
function callerContext(access: Awaited<ReturnType<typeof getAccess>>): { access: StudentAccess } | null {
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return null;
  }
  return { access: access as StudentAccess };
}

type Db = ReturnType<typeof createServiceSupabase>;

function isStageKey(value: string): value is StageKey {
  return (STAGE_KEYS as string[]).includes(value);
}

// submitStage：entryId → 這組自己的報名 → 這筆報名確認之後才會有的比賽線。別組的報名、
// 已退出的報名確認前就不會有線、亂填的 id 一律回 null。ended：這條線是不是已經結束
// （已退出，或結果已經是未入選／得獎）——結束的線不能再上傳任何階段。
async function loadLineForEntry(
  db: Db,
  entryId: string,
  groupId: string
): Promise<{ lineId: string; ended: boolean } | null> {
  if (!isUuid(entryId)) return null;

  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .select("id, withdrawn_at, result")
    .eq("id", entryId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (entryError) throw entryError;
  if (!entry) return null;

  const { data: line, error: lineError } = await db
    .from("lines")
    .select("id")
    .eq("entry_id", entryId)
    .eq("kind", "competition")
    .maybeSingle();
  if (lineError) throw lineError;
  if (!line) return null;

  const ended = isLineEnded({
    confirmedAt: null,
    withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at as string) : null,
    result: entry.result as "advanced" | "awarded" | "not_selected" | null,
  });

  return { lineId: line.id as string, ended };
}

type OwnedSubmission = { id: string; lineId: string; pdfKey: string; pdfUploadedAt: Date; ended: boolean };

// replaceStagePdf／withdrawStage 共用的擁有權檢查：submissionId → 所屬的線 → 所屬的組必須是
// 呼叫者的組。任何一步查不到、或組不對，一律回 null（呼叫端統一轉成「找不到這筆繳交」）。
async function loadOwnedSubmission(db: Db, submissionId: string, groupId: string): Promise<OwnedSubmission | null> {
  if (!isUuid(submissionId)) return null;

  const { data: submission, error: subError } = await db
    .from("stage_submissions")
    .select("id, line_id, pdf_key, pdf_uploaded_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (subError) throw subError;
  if (!submission) return null;

  const { data: line, error: lineError } = await db
    .from("lines")
    .select("group_id, entry_id")
    .eq("id", submission.line_id)
    .single();
  if (lineError) throw lineError;
  if (line.group_id !== groupId) return null;

  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .select("withdrawn_at, result")
    .eq("id", line.entry_id)
    .single();
  if (entryError) throw entryError;

  const ended = isLineEnded({
    confirmedAt: null,
    withdrawnAt: entry.withdrawn_at ? new Date(entry.withdrawn_at as string) : null,
    result: entry.result as "advanced" | "awarded" | "not_selected" | null,
  });

  return {
    id: submission.id as string,
    lineId: submission.line_id as string,
    pdfKey: submission.pdf_key as string,
    pdfUploadedAt: new Date(submission.pdf_uploaded_at as string),
    ended,
  };
}

async function expectedPrefix(db: Db, semesterId: string, groupId: string): Promise<string> {
  const { data: semester, error } = await db.from("semesters").select("name").eq("id", semesterId).single();
  if (error) throw error;
  return `${semester.name}/${groupId}/`;
}

// 第一次送出、或退回重交（該階段目前沒有待審或已通過的版本）。安全鏈跟 submitProgress 同一套：
// 字首檢查 → 票務檢查（存在、屬於呼叫者、還沒用掉）→ inspectUploaded → 原子性的 RPC。
export async function submitStage(
  entryId: string,
  stage: string,
  pdfKey: string
): Promise<{ ok: true; submissionId: string } | { ok: false; error: string }> {
  const access = await getAccess();
  const caller = callerContext(access);
  if (!caller) return { ok: false, error: NOT_FOUND };
  if (!isStageKey(stage)) return { ok: false, error: NOT_FOUND };

  const notAcknowledged = await acknowledgementRequired(caller.access.semesterId, caller.access.email);
  if (notAcknowledged) return notAcknowledged;

  const db = createServiceSupabase();
  const line = await loadLineForEntry(db, entryId, caller.access.member.groupId);
  if (!line) return { ok: false, error: NOT_FOUND };
  if (line.ended) return { ok: false, error: ENDED_ERROR };

  const prefix = await expectedPrefix(db, caller.access.semesterId, caller.access.member.groupId);
  if (!pdfKey.startsWith(prefix)) return { ok: false, error: UPLOAD_FAILED };

  const { data: ticket, error: ticketError } = await db
    .from("upload_tickets")
    .select("issuer_email, used_at")
    .eq("key", pdfKey)
    .maybeSingle();
  if (ticketError) throw ticketError;
  if (!ticket || ticket.issuer_email !== caller.access.email || ticket.used_at !== null) {
    return { ok: false, error: UPLOAD_FAILED };
  }

  const inspected = await inspectUploaded(pdfKey);
  if (!inspected || !inspected.isPdf || inspected.size > MAX_PDF_BYTES) {
    await deleteObject(pdfKey).catch(() => {});
    return { ok: false, error: UPLOAD_FAILED };
  }

  const { data: submissionId, error: rpcError } = await db.rpc("submit_stage", {
    p_line_id: line.lineId,
    p_stage: stage,
    p_key: pdfKey,
    p_size: inspected.size,
    p_by: caller.access.email,
    p_ticket: caller.access.email,
  });

  if (rpcError) {
    if (rpcError.message.includes("stage_active")) {
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: STAGE_ACTIVE_ERROR };
    }
    if (rpcError.message.includes("ended")) {
      // 應用層（loadLineForEntry）已經先擋過一次已結束的線；這裡是 RPC 內部再檢查一次撞到的
      // 時間窗（檢查完、真的送出之前，隊友剛好取消報名／填了結果）。這時候票務檢查已經證明
      // pdfKey 是呼叫者自己的，要刪掉這個孤兒物件。
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: ENDED_ERROR };
    }
    if (rpcError.code === "23505") {
      // 撞到部分唯一索引（併發送出同一階段）：走到這裡，票務檢查已經證明 pdfKey 是呼叫者
      // 自己申請、還沒用掉的——這次請求沒有真的把它用掉（insert 整個回滾），是孤兒物件，要刪。
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: STAGE_ACTIVE_ERROR };
    }
    if (rpcError.message.includes("invalid_ticket")) {
      // 票被搶先用掉：這次請求沒有真的用上這把 key，不該去刪它——它可能是別的併發請求真正
      // 用掉的那份。
      return { ok: false, error: STAGE_ACTIVE_ERROR };
    }
    throw rpcError;
  }

  revalidatePath(`/my-group/competitions/${entryId}`);
  revalidatePath("/my-group");
  return { ok: true, submissionId: submissionId as string };
}

// 換 PDF：跟 replaceProgressPdf 同一套順序——票務檢查通過之後的任何失敗都要刪掉「已經證明
// 屬於呼叫者、但沒被用上」的新物件；舊檔只有在 RPC 真的成功換掉之後才刪。
export async function replaceStagePdf(
  submissionId: string,
  pdfKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  const caller = callerContext(access);
  const db = createServiceSupabase();
  const submission = caller ? await loadOwnedSubmission(db, submissionId, caller.access.member.groupId) : null;
  if (!submission || !caller) return { ok: false, error: NOT_FOUND };

  const notAcknowledged = await acknowledgementRequired(caller.access.semesterId, caller.access.email);
  if (notAcknowledged) return notAcknowledged;

  if (submission.ended) return { ok: false, error: ENDED_ERROR };

  const prefix = await expectedPrefix(db, caller.access.semesterId, caller.access.member.groupId);
  if (!pdfKey.startsWith(prefix)) return { ok: false, error: UPLOAD_FAILED };

  const { data: ticket, error: ticketError } = await db
    .from("upload_tickets")
    .select("issuer_email, used_at")
    .eq("key", pdfKey)
    .maybeSingle();
  if (ticketError) throw ticketError;
  if (!ticket || ticket.issuer_email !== caller.access.email || ticket.used_at !== null) {
    return { ok: false, error: UPLOAD_FAILED };
  }

  // 從這裡開始 pdfKey 已經證明是呼叫者自己申請、還沒用掉的票——任何後面的失敗路徑都要把它
  // 刪掉（孤兒物件），不能留著。
  if (isLocked(submission.pdfUploadedAt, new Date())) {
    await deleteObject(pdfKey).catch(() => {});
    return { ok: false, error: LOCKED_ERROR };
  }

  const inspected = await inspectUploaded(pdfKey);
  if (!inspected || !inspected.isPdf || inspected.size > MAX_PDF_BYTES) {
    await deleteObject(pdfKey).catch(() => {});
    return { ok: false, error: UPLOAD_FAILED };
  }

  const { error: rpcError } = await db.rpc("replace_stage_pdf", {
    p_submission_id: submissionId,
    p_old_key: submission.pdfKey,
    p_new_key: pdfKey,
    p_size: inspected.size,
    p_by: caller.access.email,
    p_ticket: caller.access.email,
  });

  if (rpcError) {
    if (rpcError.message.includes("LOCKED")) {
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: LOCKED_ERROR };
    }
    if (rpcError.message.includes("stale_write")) {
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: STALE_WRITE_ERROR };
    }
    if (rpcError.message.includes("submission_not_found")) {
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: NOT_FOUND };
    }
    if (rpcError.message.includes("ended")) {
      // 跟 submitStage 同一個理由：這是 RPC 內部再檢查一次撞到的時間窗，應用層
      // （loadOwnedSubmission）已經先擋過一次。
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: ENDED_ERROR };
    }
    if (rpcError.code === "23505" || rpcError.message.includes("invalid_ticket")) {
      return { ok: false, error: UPLOAD_FAILED };
    }
    throw rpcError;
  }

  // 舊檔在資料庫成功換成新檔之後才刪，不是之前——RPC 已經用 pdf_key = p_old_key 確認過
  // 寫入前的舊檔真的就是 submission.pdfKey。
  await deleteObject(submission.pdfKey).catch(() => {});

  return { ok: true };
}

// 撤回：整筆刪除、R2 檔也刪，不留紀錄、不算版本。刪除順序跟 withdrawProgress 一樣——先讓
// 資料庫那一步成功，再刪 R2 上的物件。
export async function withdrawStage(submissionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  const caller = callerContext(access);
  const db = createServiceSupabase();
  const submission = caller ? await loadOwnedSubmission(db, submissionId, caller.access.member.groupId) : null;
  if (!submission || !caller) return { ok: false, error: NOT_FOUND };

  const notAcknowledged = await acknowledgementRequired(caller.access.semesterId, caller.access.email);
  if (notAcknowledged) return notAcknowledged;

  // controller ruling（fix round 1）：撤回跟提交／換檔不同——即使線已經結束，只要這一版還是
  // pending、還沒鎖定，還是允許撤回（不然會卡著一筆永遠不會被審的東西）。已結束只擋
  // submitStage／replaceStagePdf，不擋 withdrawStage。
  if (isLocked(submission.pdfUploadedAt, new Date())) return { ok: false, error: LOCKED_ERROR };

  const { data: deletedKey, error: rpcError } = await db.rpc("withdraw_stage", { p_submission_id: submissionId });
  if (rpcError) {
    if (rpcError.message.includes("LOCKED")) return { ok: false, error: LOCKED_ERROR };
    if (rpcError.message.includes("submission_not_found")) return { ok: false, error: NOT_FOUND };
    throw rpcError;
  }
  if (!deletedKey) return { ok: false, error: NOT_FOUND };

  await deleteObject(deletedKey as string).catch(() => {});

  return { ok: true };
}
