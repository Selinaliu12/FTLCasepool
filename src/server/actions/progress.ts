"use server";

import { getAccess } from "@/server/session";
import { acknowledgementRequired } from "@/server/queries/acknowledgement";
import { createServiceSupabase } from "@/server/supabase";
import { validateProgress } from "@/domain/progress";
import { MAX_PDF_BYTES } from "@/domain/pdf";
import { inspectUploaded, deleteObject } from "@/server/r2";
import { isLocked } from "@/domain/lock";
import type { Light } from "@/domain/lights";
import type { SupabaseClient } from "@supabase/supabase-js";

const UPLOAD_FAILED = "檔案沒有上傳成功，請重新選擇 PDF";
const NOT_FOUND = "找不到這份進度";
const LOCKED_ERROR = "已超過 2 小時，已鎖定不能修改";
const STALE_WRITE_ERROR = "這份進度剛剛被組員改過，請重新整理";

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
  const notAcknowledged = await acknowledgementRequired(access.semesterId, access.email);
  if (notAcknowledged) return notAcknowledged;

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

type OwnedReport = {
  id: string;
  lineId: string;
  periodId: string;
  pdfKey: string;
  pdfUploadedAt: Date;
};

// editProgress／replaceProgressPdf／withdrawProgress 共用的授權檢查：呼叫者必須是「這份報告
// 所屬那一組」的組員（規格：該組任何組員都可以動這份報告，不限交出去的那個人）。
//
// Fix round 1（controller ruling 2）：不管是「不是專案生」（幹部／PM／管理員）、「專案生但
// 沒有組」、「別組的專案生」、還是「reportId 根本不是合法的 UUID」，一律回同一句「找不到這份
// 進度」，不透露這份報告其實存在、也不能讓格式錯誤的 id 洩漏出一個 500。所以呼叫端一律把
// 「這次呼叫者夠不夠格」化成一個 groupId（不夠格就傳 null），交給這裡統一判斷；這裡也把
// Postgres 對非法 UUID 的錯誤（22P02）當成「找不到」處理，不 throw。
async function loadOwnedReport(db: SupabaseClient, reportId: string, groupId: string | null): Promise<OwnedReport | null> {
  if (!groupId) return null;

  const { data: report, error: reportError } = await db
    .from("progress_reports")
    .select("id, line_id, period_id, pdf_key, pdf_uploaded_at")
    .eq("id", reportId)
    .maybeSingle();
  if (reportError) {
    if (reportError.code === "22P02") return null; // invalid input syntax for type uuid
    throw reportError;
  }
  if (!report) return null;

  const { data: line, error: lineError } = await db
    .from("lines")
    .select("group_id")
    .eq("id", report.line_id)
    .single();
  if (lineError) throw lineError;
  if (line.group_id !== groupId) return null;

  return {
    id: report.id as string,
    lineId: report.line_id as string,
    periodId: report.period_id as string,
    pdfKey: report.pdf_key as string,
    pdfUploadedAt: new Date(report.pdf_uploaded_at as string),
  };
}

// 把「這次呼叫者夠不夠格動這份報告」化成一個 groupId／email／semesterId：不是登入成功、
// 不是專案生、或沒有 groupId，一律回 null，讓 loadOwnedReport() 統一判成「找不到這份進度」
// （見上面的註解）。回傳非 null 時，同時把後面會用到的 email／semesterId 帶出來，不用
// 再靠一次額外的型別窄化去證明 access.kind === "ok"。
function callerContext(
  access: Awaited<ReturnType<typeof getAccess>>
): { groupId: string; email: string; semesterId: string } | null {
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    return null;
  }
  return { groupId: access.member.groupId, email: access.email, semesterId: access.semesterId };
}

// 交完進度後 2 小時內可以改燈號與三句話，繳交時間（pdf_uploaded_at）不變。伺服器端先用
// isLocked() 擋一次（第一道防線），progress_lock trigger（見
// supabase/migrations/20260927000007_lock.sql）用 OLD.pdf_uploaded_at 再擋一次（第二道、
// 真正的防線）——即使這裡的判斷有 bug，資料庫也不會讓已鎖定的列被改動。
export async function editProgress(
  reportId: string,
  input: { light: Light; did: string; blocked: string; nextSteps: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  const caller = callerContext(access);

  const db = createServiceSupabase();
  const report = await loadOwnedReport(db, reportId, caller?.groupId ?? null);
  if (!report || !caller) return { ok: false, error: NOT_FOUND };
  const notAcknowledged = await acknowledgementRequired(caller.semesterId, caller.email);
  if (notAcknowledged) return notAcknowledged;

  if (isLocked(report.pdfUploadedAt, new Date())) return { ok: false, error: LOCKED_ERROR };

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

  const { error: updateError } = await db
    .from("progress_reports")
    .update({
      light: input.light,
      did: input.did,
      blocked: input.blocked,
      next_steps: input.nextSteps,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reportId);

  if (updateError) {
    // 就算上面的 isLocked() 檢查有 bug 而漏放行，trigger 還是會用 errcode P0001、
    // 訊息 'LOCKED' 擋下來（見 progress-lock.test.ts 的「真實邊界」測試）。
    if (updateError.message.includes("LOCKED")) return { ok: false, error: LOCKED_ERROR };
    throw updateError;
  }

  return { ok: true };
}

// 換 PDF：跟 submitProgress 一樣的安全鏈（字首檢查 → 票務檢查 → inspectUploaded），確認
// 新檔案真的合法之後，才透過 replace_progress_report()（SECURITY DEFINER RPC，見
// 20260927000007_lock.sql）原子性地「標記票用掉」＋「更新 pdf_key／pdf_size／
// pdf_uploaded_at／pdf_uploaded_by／updated_at」。RPC 成功之後才刪除舊的 R2 物件——
// 絕對不能先刪舊檔再更新資料庫，那樣如果更新失敗（例如剛好過了 2 小時被鎖定），會留下
// 「資料庫還指著一個已經被刪掉的舊檔」的半吊子狀態。
//
// Fix round 1（controller ruling 3、4）：
// - isLocked() 的檢查搬到票務檢查「之後」——在那之前，這把 pdfKey 還沒被證明是呼叫者自己
//   申請、還沒用掉的票，貿然刪除會刪到不相干的物件。一旦票務檢查通過（證明這把 key 真的是
//   呼叫者這次的上傳），後面任何失敗路徑（鎖定、RPC 回報鎖定、報告被刪、寫入被別人搶先
//   改過）都要把這個「已經確定屬於呼叫者、但沒被用上」的新物件刪掉，絕對不能留著孤兒檔案；
//   但任何失敗路徑都絕對不能刪舊檔（report.pdfKey）——只有 RPC 真的成功換掉之後才刪舊檔。
// - RPC 現在多帶一個 p_old_pdf_key，資料庫端用 `where id = ... and pdf_key = p_old_pdf_key`
//   再確認一次「呼叫者手上這份報告的狀態，跟資料庫現在的狀態一樣」，避免兩個組員幾乎同時
//   換檔／編輯時互相覆蓋掉對方剛寫入的東西（TOCTOU：這裡的 report.pdfKey 是呼叫更早之前
//   讀到的）。不一致時 RPC 丟 'stale_write'，這裡對應成「這份進度剛剛被組員改過，請重新
//   整理」。becameLate 的計算改用 RPC 在同一個交易裡（SELECT ... FOR UPDATE 之後）讀到的
//   舊 pdf_uploaded_at，而不是呼叫最初讀到、可能已經過期的 report.pdfUploadedAt。
export async function replaceProgressPdf(
  reportId: string,
  pdfKey: string
): Promise<{ ok: true; becameLate: boolean } | { ok: false; error: string }> {
  const access = await getAccess();
  const caller = callerContext(access);

  const db = createServiceSupabase();
  const report = await loadOwnedReport(db, reportId, caller?.groupId ?? null);
  if (!report || !caller) return { ok: false, error: NOT_FOUND };
  const notAcknowledged = await acknowledgementRequired(caller.semesterId, caller.email);
  if (notAcknowledged) return notAcknowledged;

  const { data: semester, error: semesterError } = await db
    .from("semesters")
    .select("name")
    .eq("id", caller.semesterId)
    .single();
  if (semesterError) throw semesterError;

  const expectedPrefix = `${semester.name}/${caller.groupId}/`;
  if (!pdfKey.startsWith(expectedPrefix)) {
    return { ok: false, error: UPLOAD_FAILED };
  }

  const { data: ticket, error: ticketError } = await db
    .from("upload_tickets")
    .select("issuer_email, used_at")
    .eq("key", pdfKey)
    .maybeSingle();
  if (ticketError) throw ticketError;
  if (!ticket || ticket.issuer_email !== caller.email || ticket.used_at !== null) {
    return { ok: false, error: UPLOAD_FAILED };
  }

  // 從這裡開始，pdfKey 已經證明是呼叫者自己申請、還沒用掉的票——任何後面的失敗路徑都要
  // 把它刪掉（孤兒物件），不能留著。

  if (isLocked(report.pdfUploadedAt, new Date())) {
    await deleteObject(pdfKey).catch(() => {});
    return { ok: false, error: LOCKED_ERROR };
  }

  const inspected = await inspectUploaded(pdfKey);
  if (!inspected || !inspected.isPdf || inspected.size > MAX_PDF_BYTES) {
    await deleteObject(pdfKey).catch(() => {});
    return { ok: false, error: UPLOAD_FAILED };
  }

  const { data: period, error: periodError } = await db
    .from("periods")
    .select("deadline")
    .eq("id", report.periodId)
    .single();
  if (periodError) throw periodError;
  const deadline = new Date(period.deadline as string);

  const now = new Date();

  const { data: oldUploadedAtRaw, error: rpcError } = await db.rpc("replace_progress_report", {
    p_report_id: reportId,
    p_old_pdf_key: report.pdfKey,
    p_pdf_key: pdfKey,
    p_issuer_email: caller.email,
    p_pdf_size: inspected.size,
    p_pdf_uploaded_at: now.toISOString(),
    p_pdf_uploaded_by: caller.email,
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
    if (rpcError.message.includes("report_not_found")) {
      await deleteObject(pdfKey).catch(() => {});
      return { ok: false, error: NOT_FOUND };
    }
    if (rpcError.code === "23505" || rpcError.message.includes("invalid_ticket")) {
      // 票在這裡失效，代表這個時間窗被別的併發請求搶先用掉——那次請求才是真正把 pdfKey
      // 用掉的人，這裡不該去刪它。
      return { ok: false, error: UPLOAD_FAILED };
    }
    throw rpcError;
  }

  // 舊檔在資料庫成功換成新檔之後才刪，不是之前。RPC 已經用 `pdf_key = p_old_pdf_key` 確認
  // 過寫入前的舊檔真的就是 report.pdfKey，這裡刪的是同一把 key。
  await deleteObject(report.pdfKey).catch(() => {});

  // becameLate：原本準時交（舊的 pdf_uploaded_at 在截止之前），換檔之後的新時間卻已經
  // 過了截止——這一期因此從「準時」變成「逾期」。用 RPC 在同一個交易裡讀到的舊時間，不是
  // 這次呼叫最初讀到、可能已經過期的 report.pdfUploadedAt。
  const oldUploadedAt = new Date(oldUploadedAtRaw as string);
  const becameLate = oldUploadedAt.getTime() <= deadline.getTime() && now.getTime() > deadline.getTime();

  return { ok: true, becameLate };
}

// 撤回：整筆刪除、R2 檔也刪，不留紀錄。刪除順序跟換 PDF 一樣——先讓資料庫那一步成功，
// 再刪 R2 上的物件；如果資料庫那步被 trigger 擋下來（已經鎖定），R2 上的檔案原封不動。
//
// Fix round 1（controller ruling 4）：delete().select("pdf_key") 拿「資料庫實際刪掉的那一
// 列」的 pdf_key 來刪 R2 物件，不是呼叫最初 loadOwnedReport() 讀到、可能已經過期的
// report.pdfKey——避免「呼叫者讀到舊檔 A，中間有人換成新檔 B，這裡卻去刪 A（沒人在用）、
// 留下真正該刪的 B」這種競態。如果 delete 沒有真的刪到任何列（例如兩個組員幾乎同時撤回，
// 第二個請求進來時報告已經被第一個刪掉了），一律當「找不到這份進度」，不誤報成功。
export async function withdrawProgress(reportId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getAccess();
  const caller = callerContext(access);

  const db = createServiceSupabase();
  const report = await loadOwnedReport(db, reportId, caller?.groupId ?? null);
  if (!report || !caller) return { ok: false, error: NOT_FOUND };
  const notAcknowledged = await acknowledgementRequired(caller.semesterId, caller.email);
  if (notAcknowledged) return notAcknowledged;

  if (isLocked(report.pdfUploadedAt, new Date())) return { ok: false, error: LOCKED_ERROR };

  const { data: deleted, error: deleteError } = await db
    .from("progress_reports")
    .delete()
    .eq("id", reportId)
    .select("pdf_key");
  if (deleteError) {
    if (deleteError.message.includes("LOCKED")) return { ok: false, error: LOCKED_ERROR };
    throw deleteError;
  }

  const deletedKey = deleted?.[0]?.pdf_key as string | undefined;
  if (!deletedKey) return { ok: false, error: NOT_FOUND };

  await deleteObject(deletedKey).catch(() => {});

  return { ok: true };
}
