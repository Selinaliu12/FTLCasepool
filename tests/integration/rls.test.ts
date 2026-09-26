import { beforeAll, describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester, clientAs, queryAsForgedJwt, withRawPg } from "./helpers";
import { env } from "../../src/server/env";

let seed: Awaited<ReturnType<typeof seedSemester>>;
beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();
});

describe("RLS：進度內容", () => {
  it("第2組學生讀不到第1組的三句話與 PDF", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data, error } = await db.from("progress_reports").select("did, pdf_key").eq("line_id", seed.lineA);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("第1組學生讀得到自己組的三句話", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("progress_reports").select("did, pdf_key").eq("line_id", seed.lineA);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("其他幹部讀不到任何組的三句話與紅燈說明，但從 line_light_events 讀得到各組燈號與時間", async () => {
    const db = await clientAs("off@g.nccu.edu.tw");
    const reports = await db.from("progress_reports").select("did").in("line_id", [seed.lineA, seed.lineB]);
    expect(reports.error).toBeNull();
    expect(reports.data).toEqual([]);
    const checkins = await db.from("checkins").select("note").eq("line_id", seed.lineA);
    expect(checkins.error).toBeNull();
    expect(checkins.data).toEqual([]);
    const events = await db.from("line_light_events").select("line_id, light").in("line_id", [seed.lineA, seed.lineB]);
    expect(events.error).toBeNull();
    const lineIds = new Set((events.data ?? []).map((e) => e.line_id));
    expect(lineIds.has(seed.lineA)).toBe(true);
    expect(lineIds.has(seed.lineB)).toBe(true);
  });

  it("專案幹部讀得到所有組的三句話", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const a = await db.from("progress_reports").select("did").eq("line_id", seed.lineA);
    expect(a.error).toBeNull();
    expect(a.data).toHaveLength(1);
  });

  it("學生從 line_light_events 只讀得到自己組", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("line_light_events").select("line_id").in("line_id", [seed.lineA, seed.lineB]);
    expect(error).toBeNull();
    const lineIds = new Set((data ?? []).map((e) => e.line_id));
    expect(lineIds.has(seed.lineA)).toBe(true);
    expect(lineIds.has(seed.lineB)).toBe(false);
  });

  it("不在名單上的學校帳號什麼都讀不到（periods 也是空的）", async () => {
    const db = await clientAs("stranger@g.nccu.edu.tw");
    const periods = await db.from("periods").select("id");
    expect(periods.error).toBeNull();
    expect(periods.data).toEqual([]);
    const members = await db.from("members").select("id");
    expect(members.error).toBeNull();
    expect(members.data).toEqual([]);
  });

  it("使用者連線直接 insert／update／delete progress_reports 一律失敗", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const insert = await db.from("progress_reports").insert({
      line_id: seed.lineA,
      period_id: seed.periodIds[1],
      light: "green",
      did: "x",
      blocked: "x",
      next_steps: "x",
      submitted_by: "a1@g.nccu.edu.tw",
      pdf_key: "x",
      pdf_size: 1,
      pdf_uploaded_at: new Date().toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
    });
    expect(insert.error).not.toBeNull();

    // Fix round 1 硬化 #3 之後，authenticated 角色連 update／delete 的底層 GRANT 都沒有了，
    // 所以現在是明確的 permission denied（42501），比原本「RLS 沒政策、影響 0 筆但不噴錯」更嚴格。
    const update = await db.from("progress_reports").update({ light: "red" }).eq("line_id", seed.lineA).select();
    expect(update.error).not.toBeNull();
    expect(update.error?.code).toBe("42501");

    const del = await db.from("progress_reports").delete().eq("line_id", seed.lineA).select();
    expect(del.error).not.toBeNull();
    expect(del.error?.code).toBe("42501");
  });
});

describe("RLS：只接受 Google 帳號", () => {
  it("provider=email 且 local_only_flags 的 allow_email_login 關閉時，me() 找不到人，progress_reports／periods 都是空的", async () => {
    const claims = {
      email: "a1@g.nccu.edu.tw",
      app_metadata: { provider: "email" },
      role: "authenticated",
    };
    const reports = await queryAsForgedJwt(
      claims,
      `select id from progress_reports where line_id = '${seed.lineA}'`,
      { allowEmailLogin: false }
    );
    expect(reports).toEqual([]);

    const periods = await queryAsForgedJwt(claims, "select id from periods", { allowEmailLogin: false });
    expect(periods).toEqual([]);
  });

  it("公開的 signUp（anon key）一律失敗", async () => {
    const anon = createClient(env.supabaseUrl, env.supabaseAnonKey);
    const { error } = await anon.auth.signUp({ email: "forged@g.nccu.edu.tw", password: "whatever-password!" });
    expect(error).not.toBeNull();
  });
});

describe("RLS：權限收斂（hardening #3／#4）", () => {
  it("匿名連線（anon key，沒登入）讀不到 semesters 或 line_light_events", async () => {
    const anon = createClient(env.supabaseUrl, env.supabaseAnonKey);
    const semesters = await anon.from("semesters").select("id");
    expect(semesters.error).not.toBeNull();

    const events = await anon.from("line_light_events").select("line_id");
    expect(events.error).not.toBeNull();
  });

  it("匿名連線呼叫 rpc('line_group') 失敗（security definer 函式不開放給 anon 執行）", async () => {
    const anon = createClient(env.supabaseUrl, env.supabaseAnonKey);
    const { error } = await anon.rpc("line_group", { l: seed.lineA });
    expect(error).not.toBeNull();
  });
});

describe("RLS：預設權限（alter default privileges，防止未來新表悄悄重新開放）", () => {
  it("public schema 新建的表，預設情況下 anon／authenticated 什麼權限都沒有", async () => {
    await withRawPg(async (client) => {
      await client.query("begin");
      try {
        await client.query("create table _default_privileges_drift_check (id int)");
        for (const role of ["anon", "authenticated"]) {
          for (const priv of ["select", "insert", "update", "delete"]) {
            const res = await client.query(
              "select has_table_privilege($1, '_default_privileges_drift_check', $2) as ok",
              [role, priv]
            );
            expect(res.rows[0].ok).toBe(false);
          }
        }
      } finally {
        await client.query("rollback");
      }
    });
  });

  // 最終審查 #1：`alter default privileges ... in schema public revoke ... from public` 是 no-op
  // （per-schema 的預設權限只能「加」權限，收不掉全域預設裡 PUBLIC 的 EXECUTE）。新建函式會透過
  // PUBLIC 讓 anon／authenticated 摸得到，這裡用一個用完就 rollback 的函式驗證真的收緊了。
  it("public schema 新建的函式，預設情況下 anon／authenticated 沒有 EXECUTE", async () => {
    await withRawPg(async (client) => {
      await client.query("begin");
      try {
        await client.query("create function _default_privileges_fn_check() returns int language sql as $$ select 1 $$");
        for (const role of ["anon", "authenticated"]) {
          const res = await client.query(
            "select has_function_privilege($1, '_default_privileges_fn_check()', 'execute') as ok",
            [role]
          );
          expect(res.rows[0].ok, role).toBe(false);
        }
      } finally {
        await client.query("rollback");
      }
    });
  });

  it("現有的 public 函式都沒有開給 PUBLIC 執行", async () => {
    await withRawPg(async (client) => {
      const res = await client.query(
        `select p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          order by 1`
      );
      expect(res.rows.map((r) => r.proname)).toEqual([]);
    });
  });

  it("anon 對 RLS 輔助函式沒有 EXECUTE（authenticated 保留，RLS 政策要用）", async () => {
    await withRawPg(async (client) => {
      for (const fn of ["my_group()", "is_staff()", "is_pm()", "can_read_content(uuid)", "can_read_status(uuid)"]) {
        const anon = await client.query("select has_function_privilege('anon', $1, 'execute') as ok", [fn]);
        expect(anon.rows[0].ok, `anon ${fn}`).toBe(false);
        const authed = await client.query("select has_function_privilege('authenticated', $1, 'execute') as ok", [fn]);
        expect(authed.rows[0].ok, `authenticated ${fn}`).toBe(true);
      }
    });
  });
});
