"use server";

import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { presignPdfGet } from "@/server/r2";
import { pdfDownloadName } from "@/domain/download";

const NOT_FOUND = "找不到這份進度" as const;

// 下載 PDF 是唯讀動作：不寫入資料，所以刻意不要求「我已了解」（acknowledgementRequired 的
// 註解說得很清楚，那是給「會寫入資料的 server action」共用的第二道防線）。這裡真正的防線是
// getAccess() 本身要是 "ok"，再交給下面的 RLS／服務身分邏輯決定看不看得到這筆報告。
//
// 專案幹部、學生走使用者身分連線，讓 progress_reports 的 read_reports policy
// （can_read_content：is_pm() 或自己組）決定；其他幹部、別組學生因此讀不到那一列，直接
// 回傳「找不到這份進度」，不透露「這筆 id 存在，只是你沒權限」。管理員（沒有 member 列）
// 走服務身分繞過 RLS。
export async function getPdfDownloadUrl(
  reportId: string
): Promise<{ ok: true; url: string } | { ok: false; error: typeof NOT_FOUND }> {
  const access = await getAccess();
  if (access.kind !== "ok") return { ok: false, error: NOT_FOUND };

  const useService = access.isAdmin && !access.member;
  const db = useService ? createServiceSupabase() : await createServerSupabase();

  const { data: report, error } = await db
    .from("progress_reports")
    .select("pdf_key, line_id, period_id")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw error;
  if (!report) return { ok: false, error: NOT_FOUND };

  const { data: line, error: lineError } = await db
    .from("lines")
    .select("group_id")
    .eq("id", report.line_id as string)
    .single();
  if (lineError) throw lineError;

  const [{ data: group, error: groupError }, { data: period, error: periodError }] = await Promise.all([
    db.from("groups").select("name, semester_id").eq("id", line.group_id as string).single(),
    db.from("periods").select("seq").eq("id", report.period_id as string).single(),
  ]);
  if (groupError) throw groupError;
  if (periodError) throw periodError;

  const { data: semester, error: semesterError } = await db
    .from("semesters")
    .select("name")
    .eq("id", group.semester_id as string)
    .single();
  if (semesterError) throw semesterError;

  const downloadName = pdfDownloadName({
    semesterName: semester.name as string,
    groupName: group.name as string,
    seq: period.seq as number,
  });

  const url = await presignPdfGet(report.pdf_key as string, downloadName);
  return { ok: true, url };
}
