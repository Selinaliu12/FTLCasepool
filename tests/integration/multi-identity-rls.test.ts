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
