"use server";

import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { validateProgress } from "@/domain/progress";
import { MAX_PDF_BYTES } from "@/domain/pdf";
import { inspectUploaded, deleteObject } from "@/server/r2";
import type { Light } from "@/domain/lights";

const UPLOAD_FAILED = "檔案沒有上傳成功，請重新選擇 PDF";

// 只有「登入成功（kind ok）且是專案生（role student）且有 groupId」的人可以交進度；
// PM／其他幹部沒有自己的組可以交，wrong_domain／not_in_roster／no_semester 沒有正式帳號。
export async function submitProgress(
  periodId: string,
  input: { light: Light; did: string; blocked: string; nextSteps: string; pdfKey: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return { ok: false, error: "只有專案生可以交進度" };
  }

  const db = createServiceSupabase();

  // period 必須屬於目前這個學期（access.semesterId 只在目前學期才會被設定，見 getAccess）。
  const { data: period, error: periodError } = await db
    .from("periods")
    .select("id")
    .eq("id", periodId)
    .eq("semester_id", access.semesterId)
    .maybeSingle();
  if (periodError) throw periodError;
  if (!period) return { ok: false, error: "找不到這一期" };

  const { data: line, error: lineError } = await db
    .from("lines")
    .select("id")
    .eq("group_id", access.member.groupId)
    .eq("kind", "project")
    .single();
  if (lineError) throw lineError;

  const validation = validateProgress({
    light: input.light,
    did: input.did,
    blocked: input.blocked,
    nextSteps: input.nextSteps,
    hasPdf: true,
  });
  if (!validation.ok) {
    const firstError = Object.values(validation.errors)[0];
    return { ok: false, error: firstError ?? "資料不完整" };
  }

  const { data: semester, error: semesterError } = await db
    .from("semesters")
    .select("name")
    .eq("id", access.semesterId)
    .single();
  if (semesterError) throw semesterError;

  const expectedPrefix = `${semester.name}/${access.member.groupId}/`;
  if (!input.pdfKey.startsWith(expectedPrefix)) {
    return { ok: false, error: UPLOAD_FAILED };
  }

  // 票務檢查（在真的去檢查 R2 上的檔案之前）：這把 key 必須是這次呼叫者自己申請
  // （requestPdfUpload，見 upload.ts）、還沒用掉的。不是自己的票（別人的 key、或已經被用掉）
  // 一律當「檔案沒有上傳成功」，而且**不刪除**那個 R2 物件——它可能是別人已經合法交出去的
  // 東西，不該被這次無效的請求動到（見 supabase/migrations/20260927000006_upload_tickets.sql
  // 開頭記的情境 A／B）。
  const { data: ticket, error: ticketError } = await db
    .from("upload_tickets")
    .select("issuer_email, used_at")
    .eq("key", input.pdfKey)
    .maybeSingle();
  if (ticketError) throw ticketError;
  if (!ticket || ticket.issuer_email !== access.email || ticket.used_at !== null) {
    return { ok: false, error: UPLOAD_FAILED };
  }

  const inspected = await inspectUploaded(input.pdfKey);
  if (!inspected || !inspected.isPdf || inspected.size > MAX_PDF_BYTES) {
    await deleteObject(input.pdfKey).catch(() => {});
    return { ok: false, error: UPLOAD_FAILED };
  }

  // 繳交時間＝R2 上檔案確認後的時間，不是使用者按下送出的時間。
  const now = new Date().toISOString();

  // submit_progress_report()：在同一個交易裡「原子性地把票標記用掉」＋「寫入
  // progress_reports」（見 20260927000006_upload_tickets.sql）。上面那次票務檢查不是原子的
  // （檢查完、這裡呼叫之前還是有時間窗），這個 RPC 用 update ... where used_at is null 再鎖
  // 一次，任何一步失敗都會讓整個函式（包含標記用掉這件事）一起回滾。
  const { error: rpcError } = await db.rpc("submit_progress_report", {
    p_pdf_key: input.pdfKey,
    p_issuer_email: access.email,
    p_line_id: line.id,
    p_period_id: periodId,
    p_light: input.light,
    p_did: input.did,
    p_blocked: input.blocked,
    p_next_steps: input.nextSteps,
    p_submitted_by: access.email,
    p_pdf_size: inspected.size,
    p_pdf_uploaded_at: now,
    p_pdf_uploaded_by: access.email,
  });

  if (rpcError) {
    // 23505 = unique_violation。只有真的撞到「同一條線、同一期不能交兩次」這個限制，才算
    // 「輸的一方」，要把自己剛上傳的 R2 檔案刪掉。如果是別的原因（票務在這個時間窗被別的
    // 併發請求搶先用掉、或 pdf_key 本身撞到 unique），代表這把 key 這次沒有真的拿去交，
    // 不該去刪它——它可能還是別人合法報告的一部分。
    if (rpcError.code === "23505" && rpcError.message.includes("progress_reports_line_id_period_id_key")) {
      await deleteObject(input.pdfKey).catch(() => {});
      return { ok: false, error: "這一期剛剛已經有組員交了，請重新整理" };
    }
    if (rpcError.code === "23505" || rpcError.message.includes("invalid_ticket")) {
      return { ok: false, error: UPLOAD_FAILED };
    }
    throw rpcError;
  }

  return { ok: true };
}
