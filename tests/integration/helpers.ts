import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../../src/server/env";
import { assertLocalSupabaseUrl } from "../../src/server/local-only";
import { resolveAccess, type Access, type RosterRow } from "../../src/domain/access";

// 本機測試專用密碼；正式環境不會用到（test-login route 只在 ENABLE_TEST_LOGIN=true 時開放）。
export const TEST_PASSWORD = "local-test-password-only!";

export function service() {
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

// okAccess() 用：seedSemester() 建立的組 id → 組名（「第1組」「第2組」），讓舊寫法的 mock 也能
// 產生正式環境的標籤「第N組專案生」。resetDb() 清空。
const knownGroupNames = new Map<string, string>();

export async function resetDb(): Promise<void> {
  knownGroupNames.clear();
  const db = service();
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
  // 依外鍵相依順序刪除（子表先刪）。semesters 上的 cascade 理論上會連動刪掉大部分資料，
  // 但逐表刪除讓這個函式不依賴 cascade 設定，測試之間的清空行為更明確。
  await db.from("checkins").delete().neq("id", ZERO_UUID);
  // upload_tickets 沒有外鍵掛在 semesters／groups 底下（key 是任意字串，見
  // supabase/migrations/20260927000006_upload_tickets.sql），cascade 刪不到它，要自己清。
  await db.from("upload_tickets").delete().not("key", "is", null);
  // progress_reports 上有 progress_lock trigger（Task 9，見 20260927000007_lock.sql）：
  // 如果上一輪測試留下一筆「已經鎖定」（pdf_uploaded_at 超過 2 小時前）的報告，一般的
  // delete（甚至 semesters 的 cascade delete，因為 cascade 對子表列一樣會觸發
  // row-level trigger）會被這顆 trigger 擋下來，導致整個 resetDb() 卡住、下一輪
  // seedSemester() 撞到 unique 限制。測試之間的清空動作本身不該受「業務規則的鎖定」
  // 限制，所以這裡改用 raw pg 連線、暫時關掉 trigger（session_replication_role =
  // replica，只在這一次連線內生效）來清空這張表。
  await withRawPg(async (client) => {
    await client.query("set session_replication_role = replica");
    await client.query("delete from progress_reports");
  });
  // stage_submissions（Task 5）上有 stage_submissions_lock trigger（見
  // 20260927000015_stage_uploads.sql），同一個理由：已鎖定的列會擋掉一般 delete（甚至
  // lines 的 cascade delete），同樣用 raw pg 連線暫時關掉 trigger 清空。
  await withRawPg(async (client) => {
    await client.query("set session_replication_role = replica");
    await client.query("delete from stage_submissions");
  });
  await db.from("entry_members").delete().not("entry_id", "is", null);
  await db.from("lines").delete().neq("id", ZERO_UUID);
  await db.from("competition_entries").delete().neq("id", ZERO_UUID);
  await db.from("competitions").delete().neq("id", ZERO_UUID);
  await db.from("periods").delete().neq("id", ZERO_UUID);
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

// Fix round 1（root-caused submit-progress.spec.ts 的間歇性失敗）：本機 Supabase Storage
// 的 S3 相容桶（R2_BUCKET，本機測試用 ftl-casepool-test）不是 migration／seed.sql 建的，
// 之前只靠 tests/integration/r2.contract.test.ts 的 beforeAll 順手建立——如果那個測試檔案
// 剛好沒跑過（例如只單獨跑 `npx playwright test`，或跑過 `supabase db reset` 之後 Storage
// 容器被重建、桶跟著消失），任何真的會 PUT 檔案到 R2 的流程（submitProgress 的上傳、
// Task 9 的換 PDF）都會在 xhr 的 PUT 這一步收到 404（bucket not found），前端顯示「上傳
// 失敗，請重試」。這不是計時上的偶然，是測試環境準備不完整；修法是讓每一輪 E2E 開始前都
// 先確定這個桶存在（idempotent：桶已存在就忽略 "already exists" 錯誤），不依賴其他測試
// 檔案「剛好」先跑過。只在本機 Supabase（R2_ENDPOINT 有設）才做，正式環境的 R2 桶本來就
// 該手動建好，不该由測試流程建立。
export async function ensureLocalStorageBucket(): Promise<void> {
  if (!env.r2.endpoint) return;
  assertLocalSupabaseUrl(env.supabaseUrl);
  const db = service();
  const { error } = await db.storage.createBucket(env.r2.bucket, { public: false });
  if (error && !error.message.includes("already exists")) throw error;
}

// acknowledged：是否替種子成員預先按過「我已了解」。交進度／點燈號／上傳相關的 server action
// 都要求呼叫者這學期已經按過（最終審查 M6），測那些動作本身的行為時傳 { acknowledged: true }；
// 預設 false，讓 e2e 的 /welcome 流程維持「第一次登入要先看說明」。
export async function seedSemester(opts: { acknowledged?: boolean } = {}) {
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

  knownGroupNames.set(groupA.id as string, groupA.name as string);
  knownGroupNames.set(groupB.id as string, groupB.name as string);

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

  if (opts.acknowledged) {
    const { error: ackError } = await db.from("acknowledgements").insert(
      ["a1", "a2", "b1", "pm", "off"].map((u) => ({ semester_id: semesterId, email: `${u}@g.nccu.edu.tw` }))
    );
    if (ackError) throw ackError;
  }

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
export async function asUser<T>(email: string, fn: () => Promise<T>, opts: { memberId?: string } = {}): Promise<T> {
  const db = service();
  const { data: semester, error: semError } = await db
    .from("semesters")
    .select("id")
    .eq("is_current", true)
    .single();
  if (semError) throw semError;
  const semesterId = semester.id as string;

  // Adjustments Task 3：同一個 email 可以有好幾列名單（多重身份），不能再用 .single()。
  // 走跟正式 getAccess() 一樣的 resolveAccess()：沒指定 memberId 時目前身份是「第一個合法身份」，
  // 多重身份的測試用 opts.memberId 指定目前身份（等同 cookie ftl_identity）。
  const { data: rows, error: mError } = await db
    .from("members")
    .select("id, semester_id, email, name, role, group_id, groups!members_group_id_fkey(name)")
    .eq("semester_id", semesterId)
    .eq("email", email)
    .is("left_at", null); // 跟 getAccess() 一樣：已離開的身份不算（Task 5）
  if (mError) throw mError;
  if (!rows || rows.length === 0) throw new Error(`asUser：${email} 不在本學期名單上`);
  if (opts.memberId && !rows.some((r) => r.id === opts.memberId)) {
    throw new Error(`asUser：${opts.memberId} 不是 ${email} 的身份`);
  }

  const access = resolveAccess(email, {
    adminEmails: [],
    semesterId,
    rows: rows.map((row) => ({
      id: row.id as string,
      semesterId: row.semester_id as string,
      email: row.email as string,
      name: row.name as string,
      role: row.role as RosterRow["role"],
      groupId: (row.group_id as string | null) ?? null,
      groupName: (row.groups as unknown as { name: string } | null)?.name ?? null,
    })),
    preferred: opts.memberId ?? null,
  });

  // 動態 import「vitest」而不是放在檔案最上面：這個檔案也被 playwright 的 global-setup.ts
  // 用到（resetDb／seedSemester），那裡不是 vitest 執行環境，頂層 import "vitest" 會直接爛掉。
  const [{ vi }, { getAccess }] = await Promise.all([import("vitest"), import("@/server/session")]);
  vi.mocked(getAccess).mockResolvedValue(access);
  return fn();
}

// Task 9 測試專用：把一筆 progress_reports 的 pdf_uploaded_at 直接改成過去某個時間，用來
// 模擬「這份報告已經交了超過 2 小時」而不用真的在測試裡等 2 小時。這個 update 本身會被
// progress_lock trigger 擋（見 20260927000007_lock.sql）——如果這筆報告已經鎖定（或改完
// 之後會被判定成鎖定），trigger 用 OLD.pdf_uploaded_at 判斷，所以「把一筆本來新鮮的報告
// 改成 3 小時前」這個動作本身不會被擋（OLD 還是新鮮的），但為了讓這支 helper 在任何情境下
// 都能可靠地造出「已鎖定」的測試資料（包括改一筆已經鎖定過的列），用 raw pg 連線暫時把這條
// 連線的 session_replication_role 設成 replica（不觸發一般 trigger），只在這一次連線、這一
// 顆 statement 的範圍內生效，連線結束後自動失效，不會影響其他測試或連線。withRawPg 已經用
// assertLocalSupabaseUrl() 擋掉正式站。
// §17-12：專案幹部只看得到負責組的內容。測試要讓某位專案幹部負責某組時用這個（同一學期的 pm 列）。
export async function assignPm(pmEmail: string, groupId: string): Promise<void> {
  const db = service();
  const { data: group, error: gErr } = await db.from("groups").select("semester_id").eq("id", groupId).single();
  if (gErr) throw gErr;
  const { data: pm, error: pmErr } = await db
    .from("members").select("id").eq("semester_id", group.semester_id).eq("email", pmEmail).eq("role", "pm").single();
  if (pmErr) throw pmErr;
  const { error } = await db.from("pm_assignments").insert({ pm_member_id: pm.id, group_id: groupId });
  if (error) throw error;
}

export async function backdatePdfUploadedAt(reportId: string, at: Date): Promise<void> {
  await withRawPg(async (client) => {
    await client.query("set session_replication_role = replica");
    await client.query("update progress_reports set pdf_uploaded_at = $1 where id = $2", [at.toISOString(), reportId]);
  });
}

// Task 5（比賽階段上傳）測試專用：同上，但改的是 stage_submissions（stage_submissions_lock
// trigger，見 20260927000015_stage_uploads.sql），不是 progress_reports。
export async function backdateStageSubmissionUploadedAt(submissionId: string, at: Date): Promise<void> {
  await withRawPg(async (client) => {
    await client.query("set session_replication_role = replica");
    await client.query("update stage_submissions set pdf_uploaded_at = $1 where id = $2", [at.toISOString(), submissionId]);
  });
}

// Task 12（幹部總覽看板）測試專用：把一期的截止日直接改成過去某個時間，模擬「這一期已經
// 逾期 N 天」而不用真的等。periods 沒有 progress_lock 那類 trigger 擋 update，直接用
// service client（略過 RLS）改就好，不用像 backdatePdfUploadedAt 那樣繞過 trigger。
export async function backdatePeriodDeadline(periodId: string, at: Date): Promise<void> {
  const db = service();
  const { error } = await db.from("periods").update({ deadline: at.toISOString() }).eq("id", periodId);
  if (error) throw error;
}

// Task 12 測試專用：seedSemester() 幫第1組留了一筆紅燈的期中點燈（跟總覽看板的逾期情境
// 無關），要驗證「哪一組排最前」時得先清掉，不然兩組同時紅燈時，同色的組名排序會蓋過
// 「哪一組因為逾期而紅」這個斷言。
export async function deleteCheckinsForLine(lineId: string): Promise<void> {
  const db = service();
  const { error } = await db.from("checkins").delete().eq("line_id", lineId);
  if (error) throw error;
}

// Task 14（看已交內容）e2e 測試專用：seedSemester() 的種子報告只在資料庫留了一筆 pdf_key，
// 沒有真的把檔案放進本機 Storage（跟 upload.ts 走的申請上傳網址流程不同）。這裡直接用
// S3 SDK 把一份最小的 PDF 內容 PUT 到同一把 key，讓「下載 PDF」這個行為在 e2e 裡真的拿得到
// 內容，不是打到 404。不能 import "@/server/r2"：那個檔案有 "server-only" guard，playwright
// 的測試行程（不是 Next.js／vitest 環境）載入會直接丟例外，所以這裡用 S3 SDK 自己重建一次
// 最小的 client（跟 r2.ts 的 client() 邏輯一樣：本機測試走 R2_ENDPOINT，path-style）。
export async function uploadTestPdf(key: string, bytes: Uint8Array): Promise<void> {
  const r2 = env.r2;
  const endpoint = r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: r2.region,
    endpoint,
    forcePathStyle: !!r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  await s3.send(
    new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: bytes, ContentType: "application/pdf" })
  );
}

// Task 14（看已交內容）測試專用：loadGroupDetail／getPdfDownloadUrl 的測試檔原本各自複製
// 一份幾乎一模一樣的 asPm／asOfficer／asStudent／asAdminNoMember，集中到這裡供兩邊共用
// （Fix round 1 controller ruling 9）。這幾個函式不直接依賴 vitest 的型別（helpers.ts 也被
// playwright 的 global-setup 用到，那裡不是 vitest 執行環境），用結構型別
// { mockResolvedValue } 描述呼叫端傳進來的、已經 vi.mock 過的 getAccess。
type AccessMock = { mockResolvedValue: (value: Access) => unknown };

// Adjustments Task 3：Access 的 ok 形狀從 { isAdmin, member } 改成 { name, identities, active }。
// 批次 1、2 的測試大多用「單一身份」的舊寫法描述呼叫者，這裡把舊寫法轉成新形狀，語意照舊：
// isAdmin＝多一個「管理員」身份且它是目前身份（fallback 順序管理員優先，跟以前 isAdmin 優先於
// member 角色一致）；member＝那一列身份。斷言本身完全不動。
type LegacyMember = {
  id: string;
  semesterId: string;
  email: string;
  name: string;
  role: "pm" | "officer" | "student";
  groupId: string | null;
};
export function okAccess(legacy: {
  kind: "ok";
  email: string;
  isAdmin: boolean;
  member: (LegacyMember & { groupName?: string }) | null;
  semesterId: string;
}): Access {
  // 直接交給正式的 resolveAccess()（F2）：身份形狀、順序、標籤「第N組專案生」都跟正式環境一樣。
  // 專案生的組名：優先用呼叫端給的 groupName，否則查 seedSemester() 登記過的組名；都沒有就報錯，
  // 不默默造出一個正式環境不可能出現的標籤。
  const m = legacy.member;
  let groupName: string | null = null;
  if (m && m.role === "student") {
    groupName = m.groupName ?? (m.groupId ? knownGroupNames.get(m.groupId) ?? null : null);
    if (!groupName) throw new Error(`okAccess：不認得組 ${m.groupId} 的組名，請在 member 加上 groupName`);
  }
  const access = resolveAccess(legacy.email, {
    adminEmails: legacy.isAdmin ? [legacy.email.trim().toLowerCase()] : [],
    semesterId: legacy.semesterId,
    rows: m ? [{ id: m.id, semesterId: m.semesterId, email: m.email, name: m.name, role: m.role, groupId: m.groupId, groupName }] : [],
    preferred: null,
  });
  if (access.kind !== "ok") throw new Error(`okAccess：舊寫法轉出來不是 ok（${access.kind}）`);
  return access;
}

export function asPm(mockGetAccess: AccessMock, semesterId: string): void {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "pm@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "pm-id", semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  }));
}

export function asOfficer(mockGetAccess: AccessMock, semesterId: string): void {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "off-id", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  }));
}

export function asStudent(
  mockGetAccess: AccessMock,
  semesterId: string,
  groupId: string,
  email = "a1@g.nccu.edu.tw",
  name = "甲一"
): void {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "s-id", semesterId, email, name, role: "student", groupId },
    semesterId,
  }));
}

export function asAdminNoMember(mockGetAccess: AccessMock, semesterId: string): void {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  }));
}

// Controller ruling 3（Task 14 fix round 1）：管理員即使在名單上也掛了一個非學生角色（這裡用
// officer 示範），身分還是「管理員 ✓」，不該被 officer 的規則擋下來。呼叫端要先用 service
// client 把這筆 member 塞進 members 表（email 必須等於 ADMIN_EMAILS 裡的那個信箱，這裡固定用
// "admin@g.nccu.edu.tw"，跟 .env.local 的設定一致）。
export function asAdminOfficer(mockGetAccess: AccessMock, semesterId: string, memberId: string): void {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: { id: memberId, semesterId, email: "admin@g.nccu.edu.tw", name: "管理員兼其他幹部", role: "officer", groupId: null },
    semesterId,
  }));
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
