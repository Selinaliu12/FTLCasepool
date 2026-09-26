import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../src/server/env";

// 本機測試專用密碼；正式環境不會用到（test-login route 只在 ENABLE_TEST_LOGIN=true 時開放）。
export const TEST_PASSWORD = "local-test-password-only!";

function service() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
}

export async function resetDb(): Promise<void> {
  const db = service();
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
  // 依外鍵相依順序刪除（子表先刪）。semesters 上的 cascade 理論上會連動刪掉大部分資料，
  // 但逐表刪除讓這個函式不依賴 cascade 設定，測試之間的清空行為更明確。
  await db.from("checkins").delete().neq("id", ZERO_UUID);
  await db.from("progress_reports").delete().neq("id", ZERO_UUID);
  await db.from("periods").delete().neq("id", ZERO_UUID);
  await db.from("lines").delete().neq("id", ZERO_UUID);
  await db.from("pm_assignments").delete().not("group_id", "is", null);
  await db.from("acknowledgements").delete().not("email", "is", null);
  await db.from("members").delete().neq("id", ZERO_UUID);
  await db.from("groups").delete().neq("id", ZERO_UUID);
  await db.from("semesters").delete().neq("id", ZERO_UUID);

  // 也清掉上一輪測試建立的本機測試帳號，避免 auth.users 重複 email 造成 createUser 失敗。
  const { data: users } = await db.auth.admin.listUsers();
  for (const u of users?.users ?? []) {
    if (u.email?.endsWith("@g.nccu.edu.tw")) {
      await db.auth.admin.deleteUser(u.id);
    }
  }
}

export async function seedSemester() {
  const db = service();

  const { data: semester, error: semError } = await db
    .from("semesters")
    .insert({ name: "115-1", is_current: true })
    .select()
    .single();
  if (semError) throw semError;
  const semesterId = semester.id as string;

  const { data: groupA, error: gaError } = await db
    .from("groups")
    .insert({ semester_id: semesterId, name: "第1組", project_name: "專案A" })
    .select()
    .single();
  if (gaError) throw gaError;
  const { data: groupB, error: gbError } = await db
    .from("groups")
    .insert({ semester_id: semesterId, name: "第2組", project_name: "專案B" })
    .select()
    .single();
  if (gbError) throw gbError;

  const { data: lineA, error: laError } = await db
    .from("lines")
    .insert({ group_id: groupA.id, kind: "project" })
    .select()
    .single();
  if (laError) throw laError;
  const { data: lineB, error: lbError } = await db
    .from("lines")
    .insert({ group_id: groupB.id, kind: "project" })
    .select()
    .single();
  if (lbError) throw lbError;

  const { data: periods, error: pError } = await db
    .from("periods")
    .insert([
      { semester_id: semesterId, seq: 1, deadline: "2026-10-01T00:00:00Z" },
      { semester_id: semesterId, seq: 2, deadline: "2026-11-01T00:00:00Z" },
    ])
    .select();
  if (pError) throw pError;
  const periodIds = periods.map((p) => p.id as string);

  const { error: mError } = await db.from("members").insert([
    { semester_id: semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: groupA.id },
    { semester_id: semesterId, email: "a2@g.nccu.edu.tw", name: "甲二", role: "student", group_id: groupA.id },
    { semester_id: semesterId, email: "b1@g.nccu.edu.tw", name: "乙一", role: "student", group_id: groupB.id },
    { semester_id: semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", group_id: null },
    { semester_id: semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", group_id: null },
  ]);
  if (mError) throw mError;

  const { error: prError } = await db.from("progress_reports").insert({
    line_id: lineA.id,
    period_id: periodIds[0],
    light: "green",
    did: "完成初版原型",
    blocked: "無",
    next_steps: "下週開始測試",
    submitted_by: "a1@g.nccu.edu.tw",
    pdf_key: "reports/lineA/period1.pdf",
    pdf_size: 1024,
    pdf_uploaded_at: new Date().toISOString(),
    pdf_uploaded_by: "a1@g.nccu.edu.tw",
  });
  if (prError) throw prError;

  const { error: ciError } = await db.from("checkins").insert([
    { line_id: lineA.id, light: "red", note: "卡在資料串接", created_by: "a1@g.nccu.edu.tw" },
    { line_id: lineB.id, light: "green", note: null, created_by: "b1@g.nccu.edu.tw" },
  ]);
  if (ciError) throw ciError;

  return { semesterId, groupA: groupA.id as string, groupB: groupB.id as string, lineA: lineA.id as string, lineB: lineB.id as string, periodIds };
}

export async function clientAs(email: string): Promise<SupabaseClient> {
  const db = service();
  const { error: createError } = await db.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  // 同一個 email 在同一輪測試中可能被 clientAs 呼叫多次；使用者已存在時直接改用登入即可。
  if (createError && !createError.message.includes("already been registered")) throw createError;

  const anon = createClient(env.supabaseUrl, env.supabaseAnonKey);
  const { data, error } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  void data;
  return anon;
}
