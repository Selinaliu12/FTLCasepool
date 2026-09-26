"use server";

import { getAccess } from "@/server/session";
import { createServerSupabase, createServiceSupabase } from "@/server/supabase";
import { presignPdfGet } from "@/server/r2";
import { pdfDownloadName } from "@/domain/download";
import { isUuid } from "@/domain/id";

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
  // 亂填的 id（不是 UUID 格式）打到 PostgREST 的 eq() 會丟 22P02，不是「查無此列」；在打
  // 資料庫前先擋下來，跟其他沒有權限的情況回傳同一種「找不到這份進度」，不要讓這種輸入變成
  // 未處理的例外。
  if (!isUuid(reportId)) return { ok: false, error: NOT_FOUND };

  const access = await getAccess();
  if (access.kind !== "ok") return { ok: false, error: NOT_FOUND };

  // Controller ruling（Task 14 fix round 1）：跟 loadGroupDetail 一樣，管理員身分本身就該
  // 看得到內容，不管有沒有 member 列、那筆 member 是不是學生以外的角色。
  const useService = access.isAdmin && access.member?.role !== "student";
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
