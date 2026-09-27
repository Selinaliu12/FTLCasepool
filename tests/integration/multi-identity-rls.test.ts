import { beforeAll, describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester, clientAs, service, withRawPg } from "./helpers";
import { env } from "../../src/server/env";

// Adjustments Task 3（規格 §14 第 2、3 點）：同一個信箱可以有好幾列名單（多組專案生、兼幹部）。
// 資料庫讀取權限＝所有身份的聯集（my_groups()／任一身份是幹部就是 is_staff()）。
// 這裡的每個情境在舊的 me() limit 1 下都會只算到「第一列」身份，所以會讀不到第二個身份的組。

let seed: Awaited<ReturnType<typeof seedSemester>>;
let groupC: string;
let lineC: string;

beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();
  const db = service();
  const { data: g, error: gErr } = await db
    .from("groups")
    .insert({ semester_id: seed.semesterId, name: "第3組", project_name: "專案C" })
    .select()
    .single();
  if (gErr) throw gErr;
  groupC = g.id as string;
  const { data: l, error: lErr } = await db.from("lines").insert({ group_id: groupC, kind: "project" }).select().single();
  if (lErr) throw lErr;
  lineC = l.id as string;

  const { error: prErr } = await db.from("progress_reports").insert({
    line_id: lineC,
    period_id: seed.periodIds[0],
    light: "yellow",
    did: "第3組的三句話",
    blocked: "無",
    next_steps: "繼續",
    submitted_by: "multi@g.nccu.edu.tw",
    pdf_key: "reports/lineC/period1.pdf",
    pdf_size: 1024,
    pdf_uploaded_at: new Date().toISOString(),
    pdf_uploaded_by: "multi@g.nccu.edu.tw",
  });
  if (prErr) throw prErr;

  // multi：第1組專案生＋第3組專案生（第1組那列先插入，舊的 me() limit 1 只會看到它）。
  // a1-off：第1組專案生（沿用 seed 的 a1）＋其他幹部。
  // stu-pm：第2組專案生＋專案幹部（學生列先插入）。
  const { error: mErr } = await db.from("members").insert([
    { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: seed.groupA },
    { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: groupC },
    { semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "officer", group_id: null },
    { semester_id: seed.semesterId, email: "stupm@g.nccu.edu.tw", name: "學生兼幹部", role: "student", group_id: seed.groupB },
    { semester_id: seed.semesterId, email: "stupm@g.nccu.edu.tw", name: "學生兼幹部", role: "pm", group_id: null },
  ]);
  if (mErr) throw mErr;
});

describe("多重身份 RLS：讀取權限取所有身份的聯集", () => {
  it("第1組＋第3組專案生：兩組的三句話、組別、燈號都讀得到，第2組讀不到", async () => {
    const db = await clientAs("multi@g.nccu.edu.tw");
    const reports = await db.from("progress_reports").select("line_id").in("line_id", [seed.lineA, seed.lineB, lineC]);
    expect(reports.error).toBeNull();
    expect(new Set(reports.data!.map((r) => r.line_id))).toEqual(new Set([seed.lineA, lineC]));

    const groups = await db.from("groups").select("id");
    expect(groups.error).toBeNull();
    expect(new Set(groups.data!.map((g) => g.id))).toEqual(new Set([seed.groupA, groupC]));

    const events = await db.from("line_light_events").select("line_id").in("line_id", [seed.lineA, seed.lineB, lineC]);
    expect(events.error).toBeNull();
    expect(new Set(events.data!.map((e) => e.line_id))).toEqual(new Set([seed.lineA, lineC]));

    // 名單：看得到兩組的組員＋自己的所有列，看不到第2組的 b1。
    const members = await db.from("members").select("email, group_id");
    expect(members.error).toBeNull();
    const emails = new Set(members.data!.map((m) => m.email));
    expect(emails.has("a2@g.nccu.edu.tw")).toBe(true);
    expect(emails.has("b1@g.nccu.edu.tw")).toBe(false);
    expect(members.data!.filter((m) => m.email === "multi@g.nccu.edu.tw")).toHaveLength(2);

    const periods = await db.from("periods").select("id");
    expect(periods.data).toHaveLength(2);
  });

  it("學生＋其他幹部：看得到所有組的燈號，也讀得到自己組的三句話，但讀不到別組的三句話", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const events = await db.from("line_light_events").select("line_id").in("line_id", [seed.lineA, seed.lineB, lineC]);
    expect(new Set(events.data!.map((e) => e.line_id))).toEqual(new Set([seed.lineA, seed.lineB, lineC]));

    const reports = await db.from("progress_reports").select("line_id").in("line_id", [seed.lineA, seed.lineB, lineC]);
    expect(reports.error).toBeNull();
    expect(reports.data!.map((r) => r.line_id)).toEqual([seed.lineA]);

    const checkins = await db.from("checkins").select("line_id, note").in("line_id", [seed.lineA, seed.lineB]);
    expect(checkins.data!.map((c) => c.line_id)).toEqual([seed.lineA]);

    const groups = await db.from("groups").select("id");
    expect(groups.data).toHaveLength(3);
  });

  it("學生（第2組）＋專案幹部：學生列排在前面也一樣讀得到所有組的三句話", async () => {
    const db = await clientAs("stupm@g.nccu.edu.tw");
    const reports = await db.from("progress_reports").select("line_id").in("line_id", [seed.lineA, seed.lineB, lineC]);
    expect(reports.error).toBeNull();
    expect(new Set(reports.data!.map((r) => r.line_id))).toEqual(new Set([seed.lineA, lineC]));
  });

  it("單一身份的學生不受影響：第2組學生只讀得到第2組", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const groups = await db.from("groups").select("id");
    expect(groups.data!.map((g) => g.id)).toEqual([seed.groupB]);
    const reports = await db.from("progress_reports").select("line_id").in("line_id", [seed.lineA, lineC]);
    expect(reports.data).toEqual([]);
  });

  it("my_groups() 只回傳專案生身份的組，且只給 authenticated 執行（anon、PUBLIC 都沒有）", async () => {
    const db = await clientAs("stupm@g.nccu.edu.tw");
    const { data, error } = await db.rpc("my_groups");
    expect(error).toBeNull();
    expect(data).toEqual([seed.groupB]);

    const anon = createClient(env.supabaseUrl, env.supabaseAnonKey);
    const anonCall = await anon.rpc("my_groups");
    expect(anonCall.error).not.toBeNull();

    await withRawPg(async (client) => {
      const res = await client.query(
        `select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'my_groups'`
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].prosecdef).toBe(true);
      expect(res.rows[0].proconfig).toEqual(["search_path=public"]);
      const anonPriv = await client.query("select has_function_privilege('anon', 'my_groups()', 'execute') as ok");
      expect(anonPriv.rows[0].ok).toBe(false);
    });
  });

  it("單列的 me()／my_group() 已經不再被任何 policy 或視圖使用（改成聯集）", async () => {
    await withRawPg(async (client) => {
      const policies = await client.query(
        `select tablename, policyname from pg_policies
          where schemaname = 'public'
            and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(\\mme\\(\\)|my_group\\(\\))'`
      );
      expect(policies.rows).toEqual([]);
      const fns = await client.query(
        `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and proname in ('me', 'my_group')`
      );
      expect(fns.rows).toEqual([]);
    });
  });
});

// Task 3 fix F3：批次 2 的報名／參賽成員／專案幹部指派／階段繳交（內容）／階段狀態（視圖）也要
// 取所有身份的聯集——每組各建一筆報名＋參賽成員＋一條比賽線＋一份階段繳交＋一筆 PM 指派。
describe("多重身份 RLS：報名、參賽成員、PM 指派、階段繳交與階段狀態", () => {
  const entryByGroup = new Map<string, string>();
  const compLineByGroup = new Map<string, string>();

  beforeAll(async () => {
    const db = service();
    const { data: comp, error: cErr } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2099-10-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (cErr) throw cErr;
    const { data: pm } = await db.from("members").select("id").eq("email", "pm@g.nccu.edu.tw").single();
    const { data: studs } = await db.from("members").select("id, group_id").eq("semester_id", seed.semesterId).eq("role", "student");

    for (const groupId of [seed.groupA, seed.groupB, groupC]) {
      const { data: entry, error: eErr } = await db
        .from("competition_entries")
        .insert({ group_id: groupId, competition_id: comp.id, created_by: "pm@g.nccu.edu.tw", confirmed_at: new Date().toISOString() })
        .select()
        .single();
      if (eErr) throw eErr;
      entryByGroup.set(groupId, entry.id as string);
      const memberId = studs!.find((s) => s.group_id === groupId)!.id;
      const { error: emErr } = await db.from("entry_members").insert({ entry_id: entry.id, member_id: memberId });
      if (emErr) throw emErr;
      const { data: line, error: lErr } = await db
        .from("lines")
        .insert({ group_id: groupId, kind: "competition", entry_id: entry.id })
        .select()
        .single();
      if (lErr) throw lErr;
      compLineByGroup.set(groupId, line.id as string);
      const { error: sErr } = await db.from("stage_submissions").insert({
        line_id: line.id,
        stage: "signup",
        version: 1,
        pdf_key: `115-1/${groupId}/signup.pdf`,
        pdf_size: 1024,
        pdf_uploaded_at: new Date().toISOString(),
        pdf_uploaded_by: "pm@g.nccu.edu.tw",
        submitted_by: "pm@g.nccu.edu.tw",
        review_status: "pending",
      });
      if (sErr) throw sErr;
      const { error: paErr } = await db.from("pm_assignments").insert({ pm_member_id: pm!.id, group_id: groupId });
      if (paErr) throw paErr;
    }
  });

  const allLines = () => [...compLineByGroup.values()];

  it("第1組＋第3組專案生：報名、參賽成員、PM 指派、階段繳交、階段狀態都讀得到兩組的，讀不到第2組", async () => {
    const db = await clientAs("multi@g.nccu.edu.tw");
    const mine = new Set([seed.groupA, groupC]);

    const entries = await db.from("competition_entries").select("group_id");
    expect(entries.error).toBeNull();
    expect(new Set(entries.data!.map((e) => e.group_id))).toEqual(mine);

    const em = await db.from("entry_members").select("entry_id");
    expect(em.error).toBeNull();
    expect(new Set(em.data!.map((e) => e.entry_id))).toEqual(new Set([entryByGroup.get(seed.groupA), entryByGroup.get(groupC)]));

    const pa = await db.from("pm_assignments").select("group_id");
    expect(pa.error).toBeNull();
    expect(new Set(pa.data!.map((p) => p.group_id))).toEqual(mine);

    const subs = await db.from("stage_submissions").select("line_id").in("line_id", allLines());
    expect(subs.error).toBeNull();
    expect(new Set(subs.data!.map((s) => s.line_id))).toEqual(new Set([compLineByGroup.get(seed.groupA), compLineByGroup.get(groupC)]));

    const status = await db.from("stage_status").select("line_id").in("line_id", allLines());
    expect(status.error).toBeNull();
    expect(new Set(status.data!.map((s) => s.line_id))).toEqual(new Set([compLineByGroup.get(seed.groupA), compLineByGroup.get(groupC)]));
  });

  it("第2組學生（單一身份）：只讀得到第2組的報名、參賽成員、PM 指派、階段繳交與狀態", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    expect((await db.from("competition_entries").select("group_id")).data!.map((e) => e.group_id)).toEqual([seed.groupB]);
    expect((await db.from("entry_members").select("entry_id")).data!.map((e) => e.entry_id)).toEqual([entryByGroup.get(seed.groupB)]);
    expect((await db.from("pm_assignments").select("group_id")).data!.map((p) => p.group_id)).toEqual([seed.groupB]);
    expect((await db.from("stage_submissions").select("line_id").in("line_id", allLines())).data!.map((s) => s.line_id)).toEqual([
      compLineByGroup.get(seed.groupB),
    ]);
    expect((await db.from("stage_status").select("line_id").in("line_id", allLines())).data!.map((s) => s.line_id)).toEqual([
      compLineByGroup.get(seed.groupB),
    ]);
  });

  it("其他幹部＋第1組專案生：階段狀態看得到所有組，階段內容（stage_submissions）只看得到自己第1組", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const status = await db.from("stage_status").select("line_id").in("line_id", allLines());
    expect(new Set(status.data!.map((s) => s.line_id))).toEqual(new Set(allLines()));

    const subs = await db.from("stage_submissions").select("line_id").in("line_id", allLines());
    expect(subs.error).toBeNull();
    expect(subs.data!.map((s) => s.line_id)).toEqual([compLineByGroup.get(seed.groupA)]);

    // 報名、參賽成員、PM 指派：其他幹部本來就看得到所有組（is_staff()）。
    expect((await db.from("competition_entries").select("group_id")).data).toHaveLength(3);
    expect((await db.from("entry_members").select("entry_id")).data).toHaveLength(3);
    expect((await db.from("pm_assignments").select("group_id")).data).toHaveLength(3);
  });
});

// Task 3 fix F4：read_members 的「自己的列」原本是每一列都跑一次 exists(select … from my_members())；
// 改成每個查詢只算一次的等價條件（email = JWT email 且 (select is_member())）。行為由上面的
// 「看得到自己的所有列」與 rls.test.ts「不在名單上的人讀不到 members」釘住。
describe("read_members：自己的列用每個查詢只算一次的條件", () => {
  it("policy 不再逐列呼叫 my_members()，改用 JWT email＋(select is_member())", async () => {
    await withRawPg(async (client) => {
      const res = await client.query(
        "select qual from pg_policies where schemaname = 'public' and tablename = 'members' and policyname = 'read_members'"
      );
      expect(res.rows).toHaveLength(1);
      const qual = res.rows[0].qual as string;
      expect(qual).not.toMatch(/my_members\(\)/);
      expect(qual).toMatch(/SELECT is_member\(\) AS is_member/);
      expect(qual).toMatch(/auth\.jwt\(\)/);
    });
  });

  it("有多列身份的人讀得到自己所有的列；只在名單外的人讀不到（等價性）", async () => {
    const multi = await clientAs("multi@g.nccu.edu.tw");
    const own = await multi.from("members").select("id").eq("email", "multi@g.nccu.edu.tw");
    expect(own.data).toHaveLength(2);
    const stranger = await clientAs("stranger2@g.nccu.edu.tw");
    expect((await stranger.from("members").select("id")).data).toEqual([]);
  });
});
