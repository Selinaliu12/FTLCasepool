import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, service, clientAs } from "./helpers";

// Task 5（成員管理）：members.left_at 不是 null ＝ 這個身份已離開（軟移除）。已離開的身份
// 不能再登入使用：getAccess() 不把它算成身份（全部離開 → not_in_roster），資料庫的身份函式
// （my_members() 以及建在它上面的 my_groups()／is_member()／is_staff()／is_pm()）也不把它算進
// 讀取權限的聯集。這裡用真的 getAccess（只替換「誰登入」與 cookie store）。

let loggedInEmail = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return {
    ...actual,
    createServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { email: loggedInEmail, app_metadata: { provider: "google" } } } }) },
    }),
  };
});

async function getAccessAs(email: string) {
  loggedInEmail = email;
  const { getAccess } = await import("@/server/session");
  return getAccess();
}

async function markLeft(email: string, filter: Record<string, string | null> = {}) {
  let q = service().from("members").update({ left_at: new Date().toISOString() }).eq("email", email);
  for (const [k, v] of Object.entries(filter)) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { error } = await q;
  if (error) throw error;
}

let seed: Awaited<ReturnType<typeof seedSemester>>;

beforeEach(async () => {
  await resetDb();
  seed = await seedSemester({ acknowledged: true });
});

describe("已離開的身份（members.left_at）", () => {
  it("唯一一列已離開 → getAccess 回 not_in_roster", async () => {
    expect((await getAccessAs("b1@g.nccu.edu.tw")).kind).toBe("ok");
    await markLeft("b1@g.nccu.edu.tw");
    expect((await getAccessAs("b1@g.nccu.edu.tw")).kind).toBe("not_in_roster");
  });

  it("只有其中一個身份離開 → 那個身份不再出現，其他身份照常", async () => {
    const db = service();
    await db.from("members").insert({
      semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: seed.groupB,
    });
    await markLeft("a1@g.nccu.edu.tw", { group_id: seed.groupA });
    const a = await getAccessAs("a1@g.nccu.edu.tw");
    if (a.kind !== "ok") throw new Error(`expected ok, got ${a.kind}`);
    expect(a.identities.map((i) => i.label)).toEqual(["第2組專案生"]);
  });

  it("my_members() 不含已離開的列；全部離開後 is_member()／my_groups() 都是空的", async () => {
    const before = await clientAs("b1@g.nccu.edu.tw");
    const { data: rowsBefore } = await before.rpc("my_members");
    expect((rowsBefore as unknown[]).length).toBe(1);

    await markLeft("b1@g.nccu.edu.tw");
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data: rows, error } = await db.rpc("my_members");
    expect(error).toBeNull();
    expect(rows).toEqual([]);
    const { data: groups } = await db.rpc("my_groups");
    expect(groups).toEqual([]);
    const { data: isMember } = await db.rpc("is_member");
    expect(isMember).toBe(false);
    // RLS 跟著變：已離開的人讀不到自己組的組別
    const { data: g } = await db.from("groups").select("id");
    expect(g).toEqual([]);
  });

  it("專案幹部身份離開 → is_staff()／is_pm() 變 false", async () => {
    await markLeft("pm@g.nccu.edu.tw");
    const db = await clientAs("pm@g.nccu.edu.tw");
    expect((await db.rpc("is_staff")).data).toBe(false);
    expect((await db.rpc("is_pm")).data).toBe(false);
  });
});
