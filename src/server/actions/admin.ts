"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/server/session";
import { createServiceSupabase } from "@/server/supabase";
import { parseRosterCsv } from "@/domain/roster-csv";
import { parseTaipeiDeadline, taipeiInputValues } from "@/domain/time";

async function requireAdmin(): Promise<void> {
  const access = await getAccess();
  // kind 可能是 "no_semester"：建立第一個學期（createSemester）就是在還沒有任何學期時呼叫的，
  // 這時 access.kind 必然是 "no_semester"，不能只接受 "ok"。wrong_domain／not_in_roster
  // 這兩種 kind 沒有 isAdmin 欄位（一定不是管理員），所以先排除掉它們。
  const isAdmin = (access.kind === "ok" || access.kind === "no_semester") && access.isAdmin;
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

export async function savePeriods(
  semesterId: string,
  rows: PeriodInput[]
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  await requireAdmin();
  const db = createServiceSupabase();

  // 既有期別的截止時間只精確到畫面上的「分」（parseTaipeiDeadline 一律補成 :59.999）。如果既有
  // 期別送回來的日期／時間跟資料庫裡的一樣（到分），就沿用資料庫裡「精確」的截止時間，不要重新
  // 解析——不然種子資料或舊資料（例如 08:00:00.000）會被當成「被改過」，凍結期別就再也存不了。
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

  // save_periods()（見 20260927000009_final_fixes.sql）在同一個 RPC（＝同一個交易）裡：鎖住這學期
  // 的期別、找出已經有人交件的「凍結」期別並確認它們原封不動、確認其他截止時間都晚於最後一個
  // 凍結期別、再刪除／修改／新增並依截止時間重新編號。規則全部由資料庫判定，這裡只負責把畫面上的
  // 日期時間轉成時間戳。
  const { error } = await db.rpc("save_periods", {
    p_semester_id: semesterId,
    p_rows: parsed.map((p) => ({ id: p.id, deadline: p.deadline.toISOString(), suggestion: p.suggestion ?? null })),
  });
  if (error) return { ok: false, errors: [error.message] };

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
