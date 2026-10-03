"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccess } from "@/server/session";
import { acknowledgementRequired } from "@/server/queries/acknowledgement";
import { createServiceSupabase } from "@/server/supabase";
import { inspectUploaded, deleteObject } from "@/server/r2";
import { MAX_PDF_BYTES } from "@/domain/pdf";
import { isLocked } from "@/domain/lock";
import { isUuid } from "@/domain/id";
import { parseTaipeiDeadline } from "@/domain/time";
import { validateAssignment, validateSubmissionNote, parseNeedsConfirm, deleteConfirmMessage } from "@/domain/assignment";

// 規格 §17：專案幹部出作業（只有出題者能改、刪），專案生繳交（規則同雙週進度：2 小時內可改、
// 之後鎖定，只有換 PDF 更新繳交時間）。寫入一律用服務身分＋資料庫函式；資料庫函式自己再檢查一次
// 出題者與鎖定（server action 是第一道、資料庫是第二道防線）。

export type AssignmentFormInput = {
  title: string;
  description: string;
  deadlineDate: string;
  deadlineTime: string;
  groupIds: string[];
};

export type AuthorResult =
  | { ok: true }
  | { ok: false; error: string; needsConfirm?: number };

const ASSIGNMENT_NOT_FOUND = "找不到這份作業";
const SUBMISSION_NOT_FOUND = "找不到這份繳交";
const UPLOAD_FAILED = "檔案沒有上傳成功，請重新選擇 PDF";
const LOCKED_ERROR = "已超過 2 小時，已鎖定不能修改";
const STALE_WRITE_ERROR = "這份作業剛剛被組員改過，請重新整理";

function revalidateAll() {
  revalidatePath("/assignments");
  revalidatePath("/my-group");
  revalidatePath("/dashboard");
}

// 目前身份必須是專案幹部（§17-1）。回傳出題者的名單列 id。
async function authorContext(): Promise<{ memberId: string; semesterId: string } | null> {
  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "pm" || !access.active.memberId) return null;
  return { memberId: access.active.memberId, semesterId: access.semesterId };
}

function parseInput(input: AssignmentFormInput): { ok: true; deadline: Date } | { ok: false; error: string } {
  let deadline: Date | null = null;
  if (input.deadlineDate || input.deadlineTime) {
    try {
      deadline = parseTaipeiDeadline(input.deadlineDate, input.deadlineTime);
    } catch {
      return { ok: false, error: "截止日期或時間格式錯誤" };
    }
  }
  const v = validateAssignment({ title: input.title, description: input.description, deadline, groupIds: input.groupIds });
  if (!v.ok) return v;
  if (input.groupIds.some((g) => !isUuid(g))) return { ok: false, error: "組別不屬於本學期" };
  return { ok: true, deadline: deadline as Date };
}

// 資料庫函式的錯誤 → 畫面文字。'needs_confirm:N' 帶回 N，讓畫面打開打字確認視窗。
function authorError(message: string): AuthorResult | null {
  const n = parseNeedsConfirm(message);
  if (n !== null) return { ok: false, error: deleteConfirmMessage(n), needsConfirm: n };
  for (const known of ["只有專案幹部可以出作業", "至少要派給一組", "組別不屬於本學期", ASSIGNMENT_NOT_FOUND]) {
    if (message.includes(known)) return { ok: false, error: known };
  }
  return null;
}

async function deleteKeys(keys: unknown): Promise<void> {
  for (const key of (keys as string[] | null) ?? []) await deleteObject(key).catch(() => {});
}

export async function createAssignment(input: AssignmentFormInput): Promise<AuthorResult & { id?: string }> {
  const author = await authorContext();
  if (!author) return { ok: false, error: "只有專案幹部可以出作業" };
  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  const db = createServiceSupabase();
  const { data, error } = await db.rpc("create_assignment", {
    p_author: author.memberId,
    p_title: input.title,
    p_description: input.description,
    p_deadline: parsed.deadline.toISOString(),
    p_group_ids: input.groupIds,
  });
  if (error) {
    const known = authorError(error.message);
    if (known) return known;
    throw error;
  }
  revalidateAll();
  return { ok: true, id: data as string };
}

// confirmCount：使用者在打字確認視窗看到的「N 組已交」。跟資料庫當下的數字不一致（中間有人交或撤回）
// 會再回 needsConfirm，畫面用新數字重新確認。
export async function updateAssignment(
  assignmentId: string,
  input: AssignmentFormInput,
  confirmCount = 0
): Promise<AuthorResult> {
  const author = await authorContext();
  if (!author || !isUuid(assignmentId)) return { ok: false, error: ASSIGNMENT_NOT_FOUND };
  const parsed = parseInput(input);
  if (!parsed.ok) return parsed;

  const db = createServiceSupabase();
  const { data, error } = await db.rpc("update_assignment", {
    p_assignment_id: assignmentId,
    p_author: author.memberId,
    p_title: input.title,
    p_description: input.description,
    p_deadline: parsed.deadline.toISOString(),
    p_group_ids: input.groupIds,
    p_confirm_count: confirmCount,
  });
  if (error) {
    const known = authorError(error.message);
    if (known) return known;
    throw error;
  }
  await deleteKeys(data);
  revalidateAll();
  return { ok: true };
}

export async function deleteAssignment(assignmentId: string, confirmCount = 0): Promise<AuthorResult> {
  const author = await authorContext();
  if (!author || !isUuid(assignmentId)) return { ok: false, error: ASSIGNMENT_NOT_FOUND };

  const db = createServiceSupabase();
  const { data, error } = await db.rpc("delete_assignment", {
    p_assignment_id: assignmentId,
    p_author: author.memberId,
    p_confirm_count: confirmCount,
  });
  if (error) {
    const known = authorError(error.message);
    if (known) return known;
    throw error;
  }
  await deleteKeys(data);
  revalidateAll();
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// 組員：繳交、改說明、換 PDF、撤回
// ─────────────────────────────────────────────────────────────────────────────

type Caller = { groupId: string; email: string; semesterId: string };

// 目前身份必須是有組的專案生；其他一律當「找不到」，不透露作業存在。
async function studentContext(): Promise<Caller | null> {
  const access = await getAccess();
  if (access.kind !== "ok" || access.active.role !== "student" || !access.active.groupId) return null;
  return { groupId: access.active.groupId, email: access.email, semesterId: access.semesterId };
}

// 上傳票＋R2 檢查（同 submitProgress）：key 必須是這次呼叫者自己申請、還沒用掉、在自己組的路徑下。
// ok 時 pdfKey 已證明屬於呼叫者，之後的失敗路徑要負責刪掉它。
async function checkUpload(
  db: SupabaseClient,
  caller: Caller,
  pdfKey: string
): Promise<{ ok: true; size: number } | { ok: false; error: string; ownsKey: boolean }> {
  const { data: semester, error: semesterError } = await db.from("semesters").select("name").eq("id", caller.semesterId).single();
  if (semesterError) throw semesterError;
  if (!pdfKey.startsWith(`${semester.name}/${caller.groupId}/`)) return { ok: false, error: UPLOAD_FAILED, ownsKey: false };

  const { data: ticket, error: ticketError } = await db.from("upload_tickets").select("issuer_email, used_at").eq("key", pdfKey).maybeSingle();
  if (ticketError) throw ticketError;
  if (!ticket || ticket.issuer_email !== caller.email || ticket.used_at !== null) {
    return { ok: false, error: UPLOAD_FAILED, ownsKey: false };
  }

  const inspected = await inspectUploaded(pdfKey);
  if (!inspected || !inspected.isPdf || inspected.size > MAX_PDF_BYTES) return { ok: false, error: UPLOAD_FAILED, ownsKey: true };
  return { ok: true, size: inspected.size };
}

export async function submitAssignment(
  assignmentId: string,
  input: { note: string; pdfKey: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await studentContext();
  if (!caller || !isUuid(assignmentId)) return { ok: false, error: ASSIGNMENT_NOT_FOUND };
  const notAcknowledged = await acknowledgementRequired(caller.semesterId, caller.email);
  if (notAcknowledged) return notAcknowledged;

  const db = createServiceSupabase();
  // 作業必須是本學期、而且派給目前這組。
  const { data: assigned, error: assignedError } = await db
    .from("assignment_groups")
    .select("assignment_id, assignments!inner(semester_id)")
    .eq("assignment_id", assignmentId)
    .eq("group_id", caller.groupId)
    .eq("assignments.semester_id", caller.semesterId)
    .maybeSingle();
  if (assignedError) throw assignedError;
  if (!assigned) return { ok: false, error: ASSIGNMENT_NOT_FOUND };

  const note = validateSubmissionNote(input.note);
  if (!note.ok) return note;

  const upload = await checkUpload(db, caller, input.pdfKey);
  if (!upload.ok) {
    if (upload.ownsKey) await deleteObject(input.pdfKey).catch(() => {});
    return { ok: false, error: upload.error };
  }

  const { error } = await db.rpc("submit_assignment", {
    p_pdf_key: input.pdfKey,
    p_issuer_email: caller.email,
    p_assignment_id: assignmentId,
    p_group_id: caller.groupId,
    p_note: input.note,
    p_submitted_by: caller.email,
    p_pdf_size: upload.size,
    p_pdf_uploaded_at: new Date().toISOString(),
    p_pdf_uploaded_by: caller.email,
  });
  if (error) {
    // 同一組幾乎同時交了兩次：輸的一方刪掉自己剛上傳的檔。
    if (error.code === "23505" && error.message.includes("assignment_submissions_assignment_id_group_id_key")) {
      await deleteObject(input.pdfKey).catch(() => {});
      return { ok: false, error: "這份作業剛剛已經有組員交了，請重新整理" };
    }
    // 交的瞬間出題者取消派給這組（外鍵擋下）。
    if (error.code === "23503") {
      await deleteObject(input.pdfKey).catch(() => {});
      return { ok: false, error: ASSIGNMENT_NOT_FOUND };
    }
    if (error.code === "23505" || error.message.includes("invalid_ticket")) return { ok: false, error: UPLOAD_FAILED };
    throw error;
  }
  revalidateAll();
  return { ok: true };
}

type OwnedSubmission = { id: string; assignmentId: string; pdfKey: string; pdfUploadedAt: Date };

// 呼叫者必須是這份繳交那一組的組員（該組任何組員都能改，不限交的人）。
async function loadOwnedSubmission(db: SupabaseClient, submissionId: string, caller: Caller | null): Promise<OwnedSubmission | null> {
  if (!caller || !isUuid(submissionId)) return null;
  const { data, error } = await db
    .from("assignment_submissions")
    .select("id, assignment_id, group_id, pdf_key, pdf_uploaded_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.group_id !== caller.groupId) return null;
  return {
    id: data.id as string,
    assignmentId: data.assignment_id as string,
    pdfKey: data.pdf_key as string,
    pdfUploadedAt: new Date(data.pdf_uploaded_at as string),
  };
}

export async function editAssignmentNote(submissionId: string, note: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await studentContext();
  const db = createServiceSupabase();
  const owned = await loadOwnedSubmission(db, submissionId, caller);
  if (!owned || !caller) return { ok: false, error: SUBMISSION_NOT_FOUND };
  const notAcknowledged = await acknowledgementRequired(caller.semesterId, caller.email);
  if (notAcknowledged) return notAcknowledged;
  if (isLocked(owned.pdfUploadedAt, new Date())) return { ok: false, error: LOCKED_ERROR };
  const v = validateSubmissionNote(note);
  if (!v.ok) return v;

  const { error } = await db
    .from("assignment_submissions")
    .update({ note: note.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", submissionId);
  if (error) {
    if (error.message.includes("LOCKED")) return { ok: false, error: LOCKED_ERROR };
    throw error;
  }
  revalidateAll();
  return { ok: true };
}

export async function replaceAssignmentPdf(
  submissionId: string,
  pdfKey: string
): Promise<{ ok: true; becameLate: boolean } | { ok: false; error: string }> {
  const caller = await studentContext();
  const db = createServiceSupabase();
  const owned = await loadOwnedSubmission(db, submissionId, caller);
  if (!owned || !caller) return { ok: false, error: SUBMISSION_NOT_FOUND };
  const notAcknowledged = await acknowledgementRequired(caller.semesterId, caller.email);
  if (notAcknowledged) return notAcknowledged;

  const upload = await checkUpload(db, caller, pdfKey);
  if (!upload.ok) {
    if (upload.ownsKey) await deleteObject(pdfKey).catch(() => {});
    return { ok: false, error: upload.error };
  }
  if (isLocked(owned.pdfUploadedAt, new Date())) {
    await deleteObject(pdfKey).catch(() => {});
    return { ok: false, error: LOCKED_ERROR };
  }

  const { data: assignment, error: assignmentError } = await db.from("assignments").select("deadline").eq("id", owned.assignmentId).single();
  if (assignmentError) throw assignmentError;
  const deadline = new Date(assignment.deadline as string);
  const now = new Date();

  const { data: oldUploadedAtRaw, error } = await db.rpc("replace_assignment_pdf", {
    p_submission_id: submissionId,
    p_old_pdf_key: owned.pdfKey,
    p_pdf_key: pdfKey,
    p_issuer_email: caller.email,
    p_pdf_size: upload.size,
    p_pdf_uploaded_at: now.toISOString(),
    p_pdf_uploaded_by: caller.email,
  });
  if (error) {
    for (const [code, message] of [["LOCKED", LOCKED_ERROR], ["stale_write", STALE_WRITE_ERROR], ["submission_not_found", SUBMISSION_NOT_FOUND]] as const) {
      if (error.message.includes(code)) {
        await deleteObject(pdfKey).catch(() => {});
        return { ok: false, error: message };
      }
    }
    if (error.code === "23505" || error.message.includes("invalid_ticket")) return { ok: false, error: UPLOAD_FAILED };
    throw error;
  }
  await deleteObject(owned.pdfKey).catch(() => {});

  const oldUploadedAt = new Date(oldUploadedAtRaw as string);
  revalidateAll();
  return { ok: true, becameLate: oldUploadedAt.getTime() <= deadline.getTime() && now.getTime() > deadline.getTime() };
}

export async function withdrawAssignment(submissionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const caller = await studentContext();
  const db = createServiceSupabase();
  const owned = await loadOwnedSubmission(db, submissionId, caller);
  if (!owned || !caller) return { ok: false, error: SUBMISSION_NOT_FOUND };
  const notAcknowledged = await acknowledgementRequired(caller.semesterId, caller.email);
  if (notAcknowledged) return notAcknowledged;
  if (isLocked(owned.pdfUploadedAt, new Date())) return { ok: false, error: LOCKED_ERROR };

  const { data: deleted, error } = await db.from("assignment_submissions").delete().eq("id", submissionId).select("pdf_key");
  if (error) {
    if (error.message.includes("LOCKED")) return { ok: false, error: LOCKED_ERROR };
    throw error;
  }
  const key = deleted?.[0]?.pdf_key as string | undefined;
  if (!key) return { ok: false, error: SUBMISSION_NOT_FOUND };
  await deleteObject(key).catch(() => {});
  revalidateAll();
  return { ok: true };
}
