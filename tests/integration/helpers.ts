import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { env } from "../../src/server/env";
import { assertLocalSupabaseUrl } from "../../src/server/local-only";
import type { Access } from "../../src/domain/access";

// 本機測試專用密碼；正式環境不會用到（test-login route 只在 ENABLE_TEST_LOGIN=true 時開放）。
export const TEST_PASSWORD = "local-test-password-only!";

function service() {
  // resetDb／seedSemester／clientAs 都會清空資料表或建立測試帳號，絕對不能不小心對正式站做這些事。
  assertLocalSupabaseUrl(env.supabaseUrl);
  return createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
}

// 直接開一條 Postgres 連線給測試自己管理交易（例如建一張用完就 rollback 的暫時資料表），
// 用來驗證「未來新建的資料表／函式，預設權限是不是真的收緊了」這種碰不到 API 層的東西。
// 只在本機 Supabase（assertLocalSupabaseUrl）才能用。
export async function withRawPg<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  assertLocalSupabaseUrl(env.supabaseUrl);
  const host = new URL(env.supabaseUrl).hostname;
  const client = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
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

// 直接開一條 Postgres 連線，用 SET LOCAL 偽造 auth.jwt() 會讀到的 request.jwt.claims，
// 藉此在不經過 GoTrue 簽發真的 JWT 的情況下，測試「provider 不是 google、也沒開 email 登入開關」
// 這種 me() 應該要擋下來的情況。只在本機 Supabase（assertLocalSupabaseUrl）才能用。
// allowEmailLogin 如果有給值，會先用 postgres 身分（這張表的擁有者）把 local_only_flags 改成想要的值，
// 最後一律 rollback：查詢本身不需要留下任何寫入，也不會影響其他測試依賴的「本機 email 登入」旗標狀態。
export async function queryAsForgedJwt<T = Record<string, unknown>>(
  claims: Record<string, unknown>,
  sql: string,
  opts: { allowEmailLogin?: boolean } = {}
): Promise<T[]> {
  assertLocalSupabaseUrl(env.supabaseUrl);
  const host = new URL(env.supabaseUrl).hostname;
  const client = new PgClient({ host, port: 54322, user: "postgres", password: "postgres", database: "postgres" });
  await client.connect();
  try {
    await client.query("begin");
    if (opts.allowEmailLogin !== undefined) {
      await client.query(
        `insert into local_only_flags (key, value) values ('allow_email_login', $1)
         on conflict (key) do update set value = excluded.value`,
        [opts.allowEmailLogin ? "on" : "off"]
      );
    }
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const res = await client.query(sql);
    return res.rows as T[];
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

// 讓 submitProgress 的併發測試（同一組兩人同時送出）能各自用自己的身分呼叫 server action。
// 依賴呼叫端已經 `vi.mock("@/server/session", () => ({ getAccess: vi.fn() }))`——這裡動態
// import 拿到的就是同一顆被 mock 過的 getAccess，把它的回傳值換成這個 email 在資料庫裡的
// 真實 access，再同步（不在中間 await）呼叫 fn()，讓 fn() 內第一次呼叫 getAccess() 讀到的
// 一定是剛剛設好的這份身分，即使兩個 asUser 是用 Promise.all 同時發動的也不會互相覆蓋。
export async function asUser<T>(email: string, fn: () => Promise<T>): Promise<T> {
  const db = service();
  const { data: semester, error: semError } = await db
    .from("semesters")
    .select("id")
    .eq("is_current", true)
    .single();
  if (semError) throw semError;
  const semesterId = semester.id as string;

  const { data: row, error: mError } = await db
    .from("members")
    .select("id, semester_id, email, name, role, group_id")
    .eq("semester_id", semesterId)
    .eq("email", email)
    .single();
  if (mError) throw mError;

  const access: Access = {
    kind: "ok",
    email: row.email,
    isAdmin: false,
    member: {
      id: row.id,
      semesterId: row.semester_id,
      email: row.email,
      name: row.name,
      role: row.role,
      groupId: row.group_id,
    },
    semesterId,
  };

  // 動態 import「vitest」而不是放在檔案最上面：這個檔案也被 playwright 的 global-setup.ts
  // 用到（resetDb／seedSemester），那裡不是 vitest 執行環境，頂層 import "vitest" 會直接爛掉。
  const [{ vi }, { getAccess }] = await Promise.all([import("vitest"), import("@/server/session")]);
  vi.mocked(getAccess).mockResolvedValue(access);
  return fn();
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
