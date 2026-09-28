"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { parseRosterCsv, validateMemberRow, memberFormError } from "@/domain/roster-csv";
import { parseTaipeiDeadline, taipeiInputValues } from "@/domain/time";
import { deleteObject } from "@/server/r2";

async function requireAdmin(): Promise<void> {
  const access = await getAccess();
  // kind 可能是 "no_semester"：建立第一個學期（createSemester）就是在還沒有任何學期時呼叫的，
  // 這時 access.kind 必然是 "no_semester"，不能只接受 "ok"。wrong_domain／not_in_roster
  // 這兩種 kind 沒有 isAdmin 欄位（一定不是管理員），所以先排除掉它們。
  // Adjustments Task 3：kind "ok" 看「目前身份」是不是管理員（規格 §14 第 3 點：動作依目前選的
  // 身份）；管理員兼名單身份的人要先切回「管理員」身份才能做管理動作。
  const isAdmin =
    (access.kind === "ok" && access.active.role === "admin") || (access.kind === "no_semester" && access.isAdmin);
  if (!isAdmin) {
    throw new Error("只有系統管理員可以這樣做");
  }
}

export async function createSemester(name: string): Promise<{ semesterId: string }> {
  await requireAdmin();

  const trimmed = name.trim();
  if (!trimmed) throw new Error("請輸入學期名稱");

  const db = createServiceSupabase();

  // create_semester()（見 20260927000005_admin_atomic.sql）把「清掉舊的 is_current」跟
  // 「插入新學期」包在同一個 RPC 呼叫裡：這是一個 Postgres statement，函式裡面途中失敗
  // （例如學期名稱撞到 unique 限制）會把整個函式做的事整批回滾，不會出現「舊學期已經被清成
  // 非當前、新學期又插入失敗」這種沒有任何學期是當前學期、把所有人鎖在外面的狀態。
  const { data, error } = await db.rpc("create_semester", { p_name: trimmed });
  if (error) {
    if (error.code === "23505") throw new Error("這個學期名稱已經存在");
    throw error;
  }

  revalidatePath("/admin");
  return { semesterId: data as string };
}

export async function importRoster(
  semesterId: string,
  csv: string
): Promise<{ ok: true; imported: number } | { ok: false; errors: string[] }> {
  await requireAdmin();
  const db = createServiceSupabase();

  const { count } = await db.from("members").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
  if (count && count > 0) {
    return { ok: false, errors: ["本學期已匯入名單；學期中的異動請用「換組」"] };
  }

  const parsed = parseRosterCsv(csv);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { error } = await db.rpc("import_roster", { p_semester_id: semesterId, rows: parsed.rows });
  if (error) return { ok: false, errors: [error.message] };

  revalidatePath("/admin");
  return { ok: true, imported: parsed.rows.length };
}

export type PeriodInput = { id?: string; date: string; time: string; suggestion?: string };

export type PeriodDeletionPreview = { periodId: string; seq: number; reportCount: number };

// 規格 §14 第 8 點：刪除有人交件的期別之前，畫面先用這個動作查出「每一期有幾組交了進度」，
// 跳確認視窗讓管理員打字確認，確認後才帶 confirmDeleteWithReports: true 呼叫 savePeriods。
// reportCount 是這一期的 progress_reports 筆數：一組只有一條專案線、同一條線同一期只能交一份
// （unique (line_id, period_id)），所以筆數＝交了進度的組數。
export async function previewPeriodDeletion(periodIds: string[]): Promise<PeriodDeletionPreview[]> {
  await requireAdmin();
  if (periodIds.length === 0) return [];
  const db = createServiceSupabase();

  const [periodsRes, reportsRes] = await Promise.all([
    db.from("periods").select("id, seq").in("id", periodIds).order("seq"),
    db.from("progress_reports").select("period_id").in("period_id", periodIds),
  ]);
  // PostgrestError 不是 Error 的實例：包成 Error，畫面（err instanceof Error）才顯示得出真正的訊息。
  if (periodsRes.error) throw new Error(periodsRes.error.message);
  if (reportsRes.error) throw new Error(reportsRes.error.message);

  const counts = new Map<string, number>();
  for (const r of reportsRes.data ?? []) {
    const id = r.period_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (periodsRes.data ?? []).map((p) => ({
    periodId: p.id as string,
    seq: p.seq as number,
    reportCount: counts.get(p.id as string) ?? 0,
  }));
}

export async function savePeriods(
  semesterId: string,
  rows: PeriodInput[],
  // expectedReportCounts：確認視窗顯示給管理員的每期交件數（previewPeriodDeletion 的結果）。資料庫在
  // 同一個交易裡比對，對不上就回「交件狀況已變動，請重新確認」，畫面重新預覽。
  opts: { confirmDeleteWithReports?: boolean; expectedReportCounts?: Record<string, number> } = {}
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  await requireAdmin();
  const db = createServiceSupabase();

  // 既有期別的截止時間只精確到畫面上的「分」（parseTaipeiDeadline 一律補成 :59.999）。如果既有
  // 期別送回來的日期／時間跟資料庫裡的一樣（到分），就沿用資料庫裡「精確」的截止時間，不要重新
  // 解析——不然種子資料或舊資料（例如 08:00:00.000）只是按了儲存就會被悄悄改掉秒數，準時與否
  // （依截止日即時計算）也可能跟著變。
  const { data: existing, error: existingError } = await db
    .from("periods")
    .select("id, deadline")
    .eq("semester_id", semesterId);
  if (existingError) return { ok: false, errors: [existingError.message] };
  const existingById = new Map((existing ?? []).map((p) => [p.id as string, new Date(p.deadline as string)]));

  const parsed: { i: number; id: string | null; deadline: Date; suggestion?: string }[] = [];
  const errors: string[] = [];
  rows.forEach((r, idx) => {
    const n = idx + 1;
    const current = r.id ? existingById.get(r.id) : undefined;
    if (current) {
      const shown = taipeiInputValues(current);
      if (shown.date === r.date && shown.time === r.time) {
        parsed.push({ i: n, id: r.id!, deadline: current, suggestion: r.suggestion });
        return;
      }
    }
    try {
      parsed.push({ i: n, id: r.id ?? null, deadline: parseTaipeiDeadline(r.date, r.time), suggestion: r.suggestion });
    } catch {
      errors.push(`第 ${n} 列：日期或時間格式錯誤`);
    }
  });

  // 找重複截止時間：對每個時間戳只保留第一次出現的列號，之後每一次重複都各自報一次錯，
  // 訊息裡的 M 是「和它重複的、列號較小的那一列」。
  const seenAt = new Map<number, number>();
  for (const { i, deadline } of parsed) {
    const t = deadline.getTime();
    const prev = seenAt.get(t);
    if (prev !== undefined) {
      errors.push(`第 ${i} 列：和第 ${prev} 列的截止時間重複`);
    } else {
      seenAt.set(t, i);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // save_periods()（見 20260928000005_periods_free_edit.sql 與 …000006_periods_free_edit_fix1.sql）
  // 在同一個 RPC（＝同一個交易）裡：鎖住這學期的期別、找出被刪的期別底下的進度（有進度又沒帶
  // 確認旗標就丟「這期已經有組別交了進度，要刪除請先確認」；帶了確認旗標但交件數跟確認視窗看到的
  // 不一樣就丟「交件狀況已變動，請重新確認」）、刪除進度與期別、修改／新增並依截止時間重新編號，
  // 回傳被刪進度的 pdf_key。
  const { data: deletedKeys, error } = await db.rpc("save_periods", {
    p_semester_id: semesterId,
    p_rows: parsed.map((p) => ({ id: p.id, deadline: p.deadline.toISOString(), suggestion: p.suggestion ?? null })),
    p_confirm_delete_with_reports: opts.confirmDeleteWithReports === true,
    p_expected_report_counts: opts.expectedReportCounts ?? null,
  });
  if (error) return { ok: false, errors: [error.message] };

  // 交易已經 commit，才去刪 R2 物件。刪檔失敗只記 log、動作仍算成功：資料庫裡的進度已經不在，
  // 留下的孤兒檔案由批次 3 的清掃處理。
  await Promise.all(
    ((deletedKeys as string[] | null) ?? []).map(async (key) => {
      try {
        await deleteObject(key);
      } catch (e) {
        console.error(`savePeriods：刪除期別後刪 R2 物件失敗（${key}）`, e);
      }
    })
  );

  revalidatePath("/admin");
  return { ok: true };
}

export async function setPmGroups(pmMemberId: string, groupIds: string[]): Promise<void> {
  await requireAdmin();
  const db = createServiceSupabase();

  // set_pm_groups()（見 20260927000005_admin_atomic.sql）在同一個 RPC 呼叫裡驗證每個
  // group_id 都屬於這位幹部的學期（不屬於就丟「組別不屬於本學期」）、再刪除舊的指派＋插入
  // 新的。原本是分開的兩次呼叫：先整批刪除、再整批插入，插入中途失敗（例如某個 group_id 其實
  // 是別的學期的）會留下「舊的已經刪了、新的沒插完」的髒狀態；包成一個函式讓失敗時原本的指派
  // 完全不受影響。
  const { error } = await db.rpc("set_pm_groups", { p_pm_member_id: pmMemberId, p_group_ids: groupIds });
  if (error) throw new Error(error.message);

  revalidatePath("/admin");
}

export async function setRedAfterHours(semesterId: string, hours: number): Promise<void> {
  await requireAdmin();
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
    throw new Error("紅燈門檻必須是 1 到 720 之間的整數小時");
  }
  const db = createServiceSupabase();
  const { error } = await db.from("semesters").update({ red_after_hours: hours }).eq("id", semesterId);
  if (error) throw error;

  revalidatePath("/admin");
}

export async function moveMember(memberId: string, toGroupId: string): Promise<void> {
  await requireAdmin();
  const db = createServiceSupabase();

  const { data: member, error: memberError } = await db
    .from("members")
    .select("email, role, semester_id")
    .eq("id", memberId)
    .single();
  if (memberError) throw memberError;
  if (member.role !== "student") throw new Error("只有專案生可以換組");

  const { data: group, error: groupError } = await db.from("groups").select("semester_id, name").eq("id", toGroupId).single();
  if (groupError) throw groupError;
  if (group.semester_id !== member.semester_id) throw new Error("目標組別必須在同一個學期");

  // §14：同一個人可以同時有多列專案生身份（多組），moveMember 只搬動這一列，不動這個人在
  // 其他組別的身份列。如果這個人在目標組已經有一列專案生身份（跟被搬動的這一列是不同的
  // members 列），搬過去會撞 members_identity_key 唯一索引，先在這裡查出來給一句看得懂的
  // 錯誤訊息，而不是讓呼叫端收到資料庫的 23505。組名本身就是「第N組」的格式（CSV 匯入時
  // 直接拿組別欄位當組名），訊息直接套用組名即可，不用另外算序號。
  const { data: existing, error: existingError } = await db
    .from("members")
    .select("id")
    .eq("semester_id", member.semester_id)
    .eq("email", member.email)
    .eq("role", "student")
    .eq("group_id", toGroupId)
    .neq("id", memberId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    throw new Error(`這位同學已經在${group.name}了`);
  }

  const { error } = await db.from("members").update({ group_id: toGroupId }).eq("id", memberId);
  if (error) {
    // 上面的預先查詢和這個 update 之間有極小的競速窗口（例如另一個管理員同時把這個人
    // 搬進同一組）；真的撞上 members_identity_key 唯一索引時，資料庫會回 23505，
    // 這裡轉成跟預先查詢一樣看得懂的訊息，而不是把 raw error 丟給呼叫端。
    if (error.code === "23505") {
      throw new Error(`這位同學已經在${group.name}了`);
    }
    throw error;
  }

  revalidatePath("/admin");
}

export type AddMemberInput = {
  email: string;
  name: string;
  // 中文角色名稱：專案幹部／其他幹部／專案生（跟名單 CSV 一樣）
  role: string;
  studentId: string;
  deptYear: string;
  // 專案生的組 id；幹部留空字串
  groupId: string;
};
export type AddMemberResult = { ok: true; memberId: string; restored: boolean } | { ok: false; error: string };

// 規格 §16 第 2、6 點：新增一個人（或替已在名單上的人加一個身份）；對已離開的身份再新增一次＝恢復
// 原本那一列。只有目前身份是管理員才能做（requireAdmin 丟例外，跟其他管理員動作一致）；欄位規則跟
// 名單 CSV 共用 validateMemberRow()，需要看資料庫的檢查（組別屬於本學期、同一信箱還在的身份姓名／
// 學號／系級一致、身份重複／恢復）在 admin_add_member() 同一個交易裡做（見
// 20260929000003_member_admin.sql）。可以預期的錯誤回 { ok: false, error }，畫面直接顯示。
export async function addMember(input: AddMemberInput): Promise<AddMemberResult> {
  await requireAdmin();
  const access = await getAccess();
  if (access.kind !== "ok") return { ok: false, error: "還沒有本學期，請先建立學期" };

  const checked = validateMemberRow({ ...input, group: input.groupId });
  if (!checked.ok) return { ok: false, error: memberFormError(checked.error) };
  const v = checked.value;

  const db = createServiceSupabase();
  const { data, error } = await db.rpc("admin_add_member", {
    p_semester_id: access.semesterId,
    p_email: v.email,
    p_name: v.name,
    p_role: v.role,
    p_student_id: v.studentId,
    p_dept_year: v.deptYear,
    p_group_id: v.group,
  });
  if (error) {
    // P0001＝函式裡 raise exception 的業務規則訊息（中文，直接給使用者看）；其他是非預期錯誤。
    if (error.code === "P0001") return { ok: false, error: error.message };
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  const result = data as { id: string; restored: boolean };
  return { ok: true, memberId: result.id, restored: result.restored };
}
