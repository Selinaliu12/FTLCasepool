"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { validateCompetition, type CompetitionInput, type CompetitionFieldErrors } from "@/domain/competition";
import { parseTaipeiDeadline } from "@/domain/time";
import { isUuid } from "@/domain/id";
import { isStaffIdentity, type Access } from "@/domain/access";

export type CompetitionFormInput = {
  name: string;
  organizer?: string;
  theme?: string;
  eligibility?: string;
  teamSize?: string;
  prize?: string;
  url: string;
  signupDate: string;
  signupTime?: string;
  submissionDate?: string;
  submissionTime?: string;
  finalDate?: string;
  finalTime?: string;
};

// 只有管理員、專案幹部、其他幹部可以新增／編輯／發布競賽（規格第 3 節）；其他人一律拒絕。
async function requireStaff(): Promise<Extract<Access, { kind: "ok" }>> {
  const access = await getAccess();
  if (access.kind !== "ok") throw new Error("只有幹部可以編輯競賽");
  const isStaff = isStaffIdentity(access.active);
  if (!isStaff) throw new Error("只有幹部可以編輯競賽");
  return access;
}

// 日期＋時間輸入：沒填日期＝這個欄位沒填（選填的繳件日／決賽日可以整個留空）；填了日期但沒填
// 時間，報名／繳件截止時間預設 23:59，決賽日期也預設 23:59（controller ruling §2）。
// parseTaipeiDeadline 格式錯誤時回傳一個帶 error 訊息的結果，不丟例外，讓呼叫端可以把它併進
// 欄位錯誤一起顯示。
function parseField(date: string | undefined, time: string | undefined): { date: Date | null; error?: string } {
  const trimmedDate = (date ?? "").trim();
  if (!trimmedDate) return { date: null };
  try {
    return { date: parseTaipeiDeadline(trimmedDate, (time ?? "").trim() || "23:59") };
  } catch {
    return { date: null, error: "日期或時間格式錯誤" };
  }
}

type ParsedForm =
  | { ok: true; domainInput: CompetitionInput }
  | { ok: false; errors: CompetitionFieldErrors };

function parseForm(input: CompetitionFormInput): ParsedForm {
  const signup = parseField(input.signupDate, input.signupTime);
  const submission = parseField(input.submissionDate, input.submissionTime);
  const final = parseField(input.finalDate, input.finalTime);

  const parseErrors: CompetitionFieldErrors = {};
  if (signup.error) parseErrors.signupDeadline = signup.error;
  if (submission.error) parseErrors.submissionDeadline = submission.error;
  if (final.error) parseErrors.finalDate = final.error;

  const domainInput: CompetitionInput = {
    name: input.name,
    organizer: input.organizer ?? "",
    theme: input.theme ?? "",
    eligibility: input.eligibility ?? "",
    teamSize: input.teamSize ?? "",
    prize: input.prize ?? "",
    url: input.url,
    signupDeadline: signup.date,
    submissionDeadline: submission.date,
    finalDate: final.date,
  };

  const validation = validateCompetition(domainInput);
  const errors: CompetitionFieldErrors = { ...(validation.ok ? {} : validation.errors), ...parseErrors };

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, domainInput };
}

function trimmedOrNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

export async function createCompetition(
  input: CompetitionFormInput
): Promise<{ ok: true; id: string } | { ok: false; errors: CompetitionFieldErrors }> {
  const access = await requireStaff();
  const parsed = parseForm(input);
  if (!parsed.ok) return parsed;

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competitions")
    .insert({
      semester_id: access.semesterId,
      name: parsed.domainInput.name.trim(),
      organizer: trimmedOrNull(parsed.domainInput.organizer),
      theme: trimmedOrNull(parsed.domainInput.theme),
      eligibility: trimmedOrNull(parsed.domainInput.eligibility),
      team_size: trimmedOrNull(parsed.domainInput.teamSize),
      prize: trimmedOrNull(parsed.domainInput.prize),
      url: parsed.domainInput.url.trim(),
      signup_deadline: parsed.domainInput.signupDeadline!.toISOString(),
      submission_deadline: parsed.domainInput.submissionDeadline?.toISOString() ?? null,
      final_date: parsed.domainInput.finalDate?.toISOString() ?? null,
      status: "draft",
      created_by: access.email,
    })
    .select()
    .single();
  if (error) throw error;

  revalidatePath("/competitions");
  return { ok: true, id: data.id as string };
}

async function findOwnCompetition(
  db: ReturnType<typeof createServiceSupabase>,
  id: string,
  semesterId: string
): Promise<{ id: string } | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db.from("competitions").select("id").eq("id", id).eq("semester_id", semesterId).maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

export async function updateCompetition(
  id: string,
  input: CompetitionFormInput
): Promise<{ ok: true } | { ok: false; errors: CompetitionFieldErrors }> {
  const access = await requireStaff();
  const db = createServiceSupabase();

  const existing = await findOwnCompetition(db, id, access.semesterId);
  if (!existing) throw new Error("找不到這場比賽");

  const parsed = parseForm(input);
  if (!parsed.ok) return parsed;

  const { error } = await db
    .from("competitions")
    .update({
      name: parsed.domainInput.name.trim(),
      organizer: trimmedOrNull(parsed.domainInput.organizer),
      theme: trimmedOrNull(parsed.domainInput.theme),
      eligibility: trimmedOrNull(parsed.domainInput.eligibility),
      team_size: trimmedOrNull(parsed.domainInput.teamSize),
      prize: trimmedOrNull(parsed.domainInput.prize),
      url: parsed.domainInput.url.trim(),
      signup_deadline: parsed.domainInput.signupDeadline!.toISOString(),
      submission_deadline: parsed.domainInput.submissionDeadline?.toISOString() ?? null,
      final_date: parsed.domainInput.finalDate?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;

  revalidatePath("/competitions");
  revalidatePath(`/competitions/${id}/edit`);
  return { ok: true };
}

async function setStatus(id: string, status: "published"): Promise<void> {
  const access = await requireStaff();
  const db = createServiceSupabase();

  const existing = await findOwnCompetition(db, id, access.semesterId);
  if (!existing) throw new Error("找不到這場比賽");

  const { error } = await db.from("competitions").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;

  revalidatePath("/competitions");
  revalidatePath(`/competitions/${id}/edit`);
}

export async function publishCompetition(id: string): Promise<void> {
  await setStatus(id, "published");
}

const HAS_ENTRIES = "已經有組別報名這場比賽，不能取消發布";

// 已經有組別掛了（未退出）的比賽不能取消發布（final review IMPORTANT 1a）：草稿會被
// read_competitions 的 RLS 擋掉，學生的報名頁、比賽線、階段下載都會讀不到比賽。檢查與寫入
// 都在 unpublish_competition()（FOR UPDATE 鎖比賽那一列）裡原子地做；另一個方向（取消發布
// 之後才 insert 報名）由 competition_entries 的 insert trigger 擋，見
// 20260927000019_batch2_final_fixes.sql。回傳錯誤而不是 throw：production 的 server action
// 例外訊息會被遮掉，幹部看不到原因。
export async function unpublishCompetition(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireStaff();
  const db = createServiceSupabase();

  const existing = await findOwnCompetition(db, id, access.semesterId);
  if (!existing) throw new Error("找不到這場比賽");

  const { error } = await db.rpc("unpublish_competition", { p_competition_id: id, p_semester_id: access.semesterId });
  if (error) {
    if (error.message === "has_entries") return { ok: false, error: HAS_ENTRIES };
    if (error.message === "competition_not_found") throw new Error("找不到這場比賽");
    throw error;
  }

  revalidatePath("/competitions");
  revalidatePath(`/competitions/${id}/edit`);
  return { ok: true };
}
