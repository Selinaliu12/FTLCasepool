import { beforeAll, describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { resetDb, seedSemester, clientAs, service, withRawPg } from "./helpers";
import { env } from "../../src/server/env";

// Task 4（規格 §14 第 6、7 點，dispatch：「RLS 測試＋突變檢查」）：組別備註與組員清單沿用
// groups／members 現有的 RLS（read_groups／read_members，Task 3 改成聯集）——這裡直接驗證
// 「別組學生讀不到、幹部讀得到」，以及「沒有人能繞過 server action 直接呼叫
// update_group_note()」。

let seed: Awaited<ReturnType<typeof seedSemester>>;

beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();
  const db = service();
  const { error } = await db
    .from("groups")
    .update({ note: "第1組的主題", note_updated_by: "甲一", note_updated_at: new Date().toISOString() })
    .eq("id", seed.groupA);
  if (error) throw error;
});

describe("組別備註／組員清單 RLS：讀取", () => {
  it("別組學生（第2組）讀不到第1組的備註與組員", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const groups = await db.from("groups").select("id, note").eq("id", seed.groupA);
    expect(groups.error).toBeNull();
    expect(groups.data).toEqual([]); // read_groups：不是自己的組，也不是幹部，整列讀不到。

    const members = await db.from("members").select("email").eq("group_id", seed.groupA);
    expect(members.error).toBeNull();
    expect(members.data).toEqual([]);
  });

  it("該組學生（第1組）讀得到自己組的備註與組員", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const groups = await db.from("groups").select("id, note").eq("id", seed.groupA).single();
    expect(groups.error).toBeNull();
    expect(groups.data!.note).toBe("第1組的主題");

    const members = await db.from("members").select("email").eq("group_id", seed.groupA);
    expect(members.error).toBeNull();
    expect(members.data!.map((m) => m.email).sort()).toEqual(["a1@g.nccu.edu.tw", "a2@g.nccu.edu.tw"]);
  });

  it("其他幹部讀得到所有組的備註與組員（規格第 14 節第 7 點）", async () => {
    const db = await clientAs("off@g.nccu.edu.tw");
    const groups = await db.from("groups").select("id, note").eq("id", seed.groupA).single();
    expect(groups.error).toBeNull();
    expect(groups.data!.note).toBe("第1組的主題");

    const members = await db.from("members").select("email").eq("group_id", seed.groupA);
    expect(members.error).toBeNull();
    expect(members.data!.length).toBeGreaterThan(0);
  });

  it("專案幹部讀得到所有組的備註", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const groups = await db.from("groups").select("id, note").eq("id", seed.groupA).single();
    expect(groups.error).toBeNull();
    expect(groups.data!.note).toBe("第1組的主題");
  });
});

describe("update_group_note()：突變檢查，只有 service_role 能呼叫", () => {
  it("authenticated（就算是該組的學生）直接呼叫 RPC 會被拒絕", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { error } = await db.rpc("update_group_note", {
      p_group_id: seed.groupA,
      p_note: "偷改",
      p_updated_by: "甲一",
    });
    expect(error).not.toBeNull();

    // 確認真的沒有寫入。
    const row = await service().from("groups").select("note").eq("id", seed.groupA).single();
    expect(row.data!.note).toBe("第1組的主題");
  });

  it("anon 呼叫 RPC 會被拒絕", async () => {
    const anon = createClient(env.supabaseUrl, env.supabaseAnonKey);
    const { error } = await anon.rpc("update_group_note", {
      p_group_id: seed.groupA,
      p_note: "偷改",
      p_updated_by: "路人",
    });
    expect(error).not.toBeNull();
  });

  it("函式本身是 SECURITY DEFINER、search_path=public，且只有 service_role 有 execute 權限", async () => {
    await withRawPg(async (client) => {
      const res = await client.query(
        `select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'update_group_note'`
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].prosecdef).toBe(true);
      expect(res.rows[0].proconfig).toEqual(["search_path=public"]);

      const authenticatedPriv = await client.query(
        "select has_function_privilege('authenticated', 'update_group_note(uuid, text, text)', 'execute') as ok"
      );
      expect(authenticatedPriv.rows[0].ok).toBe(false);
      const anonPriv = await client.query(
        "select has_function_privilege('anon', 'update_group_note(uuid, text, text)', 'execute') as ok"
      );
      expect(anonPriv.rows[0].ok).toBe(false);
      const servicePriv = await client.query(
        "select has_function_privilege('service_role', 'update_group_note(uuid, text, text)', 'execute') as ok"
      );
      expect(servicePriv.rows[0].ok).toBe(true);
    });
  });
});
