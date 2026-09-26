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

  const inspected = await inspectUploaded(input.pdfKey);
  if (!inspected || !inspected.isPdf || inspected.size > MAX_PDF_BYTES) {
    await deleteObject(input.pdfKey).catch(() => {});
    return { ok: false, error: UPLOAD_FAILED };
  }

  // 繳交時間＝R2 上檔案確認後的時間，不是使用者按下送出的時間。
  const now = new Date().toISOString();
  const { error: insertError } = await db.from("progress_reports").insert({
    line_id: line.id,
    period_id: periodId,
    light: input.light,
    did: input.did,
    blocked: input.blocked,
    next_steps: input.nextSteps,
    submitted_by: access.email,
    pdf_key: input.pdfKey,
    pdf_size: inspected.size,
    pdf_uploaded_at: now,
    pdf_uploaded_by: access.email,
  });

  if (insertError) {
    // 23505 = unique_violation：同一條線、同一期已經有人先交了（unique (line_id, period_id)）。
    // 輸的這一方把自己剛上傳的 R2 檔案刪掉，避免留下孤兒檔案。
    if (insertError.code === "23505") {
      await deleteObject(input.pdfKey).catch(() => {});
      return { ok: false, error: "這一期剛剛已經有組員交了，請重新整理" };
    }
    throw insertError;
  }

  return { ok: true };
}
