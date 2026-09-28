import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, service } from "./helpers";

// Adjustments Task 3：getAccess() 讀 cookie ftl_identity 決定目前身份（每次都對照名單驗證），
// switchIdentity() 設定 cookie 並導到該身份的首頁。這裡用真的 getAccess（不 mock
// @/server/session），只把「誰登入」（createServerSupabase().auth.getUser）與 Next 的 cookie
// store／redirect 換成測試替身，其餘（學期、名單、組名）都是真的資料庫。

const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();
const setCalls: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    getAll: () => [...jar.entries()].map(([name, v]) => ({ name, value: v.value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      jar.set(name, { value, options });
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

let loggedInEmail = "";
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return {
    ...actual,
    createServerSupabase: async () => ({
      auth: { getUser: async () => ({ data: { user: { email: loggedInEmail, app_metadata: { provider: "google" } } } }) },
    }),
  };
});

// getAccess 是 React cache() 包出來的；vitest 不在 RSC 環境，cache() 不會記憶，每次呼叫都重查。
async function access() {
  const { getAccess } = await import("@/server/session");
  const a = await getAccess();
  if (a.kind !== "ok") throw new Error(`expected ok, got ${a.kind}`);
  return a;
}

async function switchTo(id: string): Promise<string> {
  const { switchIdentity } = await import("@/server/actions/identity");
  try {
    await switchIdentity(id);
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
  throw new Error("switchIdentity 沒有導頁");
}

let seed: Awaited<ReturnType<typeof seedSemester>>;
let groupC: string;
let multiA: string;
let multiC: string;
let a1Officer: string;

beforeEach(async () => {
  jar.clear();
  setCalls.length = 0;
  await resetDb();
  seed = await seedSemester({ acknowledged: true });
  const db = service();
  const { data: g } = await db.from("groups").insert({ semester_id: seed.semesterId, name: "第3組", project_name: "專案C" }).select().single();
  groupC = g!.id as string;
  const { data: rows, error } = await db
    .from("members")
    .insert([
      // 故意先插第3組：身份順序要依組名自然排序，不是插入順序。
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: groupC },
      { semester_id: seed.semesterId, email: "multi@g.nccu.edu.tw", name: "多組", role: "student", group_id: seed.groupA },
      { semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "officer", group_id: null },
    ])
    .select("id, email, role, group_id");
  if (error) throw error;
  multiC = rows!.find((r) => r.email === "multi@g.nccu.edu.tw" && r.group_id === groupC)!.id as string;
  multiA = rows!.find((r) => r.email === "multi@g.nccu.edu.tw" && r.group_id === seed.groupA)!.id as string;
  a1Officer = rows!.find((r) => r.email === "a1@g.nccu.edu.tw")!.id as string;
});

describe("getAccess：多重身份與 cookie", () => {
  it("沒有 cookie：身份依規則排序，目前身份＝第一個（第1組專案生在第3組前面）", async () => {
    loggedInEmail = "multi@g.nccu.edu.tw";
    const a = await access();
    expect(a.name).toBe("多組");
    expect(a.identities.map((i) => i.label)).toEqual(["第1組專案生", "第3組專案生"]);
    expect(a.active).toEqual({ memberId: multiA, role: "student", groupId: seed.groupA, label: "第1組專案生" });
  });

  it("cookie 指到自己的第3組身份 → 目前身份是第3組", async () => {
    loggedInEmail = "multi@g.nccu.edu.tw";
    jar.set("ftl_identity", { value: multiC });
    expect((await access()).active.groupId).toBe(groupC);
  });

  it("cookie 被竄改成別人的身份（a1 的其他幹部列）→ 退回第一個合法身份，不報錯、不越權", async () => {
    loggedInEmail = "multi@g.nccu.edu.tw";
    jar.set("ftl_identity", { value: a1Officer });
    const a = await access();
    expect(a.active.memberId).toBe(multiA);
    expect(a.identities.some((i) => i.role === "officer")).toBe(false);
  });

  it("cookie 是不存在的身份／亂碼／admin（不是管理員）→ 退回第一個合法身份", async () => {
    loggedInEmail = "a1@g.nccu.edu.tw";
    for (const value of ["00000000-0000-0000-0000-000000000000", "garbage'; drop table members;--", "admin"]) {
      jar.set("ftl_identity", { value });
      const a = await access();
      // a1：其他幹部＋第1組專案生，幹部排前面。
      expect(a.active).toEqual({ memberId: a1Officer, role: "officer", groupId: null, label: "其他幹部" });
    }
  });

  it("換組（moveMember 動作）只搬那一列：cookie 指的身份跟著新組走，同一人的其他身份不受影響", async () => {
    // 管理員（ADMIN_EMAILS、不在名單上）真的呼叫 moveMember 這個 server action（Task 3 fix F5）。
    loggedInEmail = "admin@g.nccu.edu.tw";
    const { moveMember } = await import("@/server/actions/admin");
    await moveMember(multiA, seed.groupB);

    loggedInEmail = "multi@g.nccu.edu.tw";
    jar.set("ftl_identity", { value: multiA });
    const a = await access();
    expect(a.active).toEqual({ memberId: multiA, role: "student", groupId: seed.groupB, label: "第2組專案生" });
    expect(a.identities.map((i) => i.label)).toEqual(["第2組專案生", "第3組專案生"]);
  });

  it("cookie 指的身份列被刪掉（例如重新匯入名單）→ 乾淨地退回第一個合法身份", async () => {
    loggedInEmail = "multi@g.nccu.edu.tw";
    jar.set("ftl_identity", { value: multiA });
    await service().from("members").delete().eq("id", multiA);
    const a = await access();
    expect(a.active.memberId).toBe(multiC);
    expect(a.identities).toHaveLength(1);
  });
});

describe("switchIdentity", () => {
  it("切到自己的第3組身份：設定 httpOnly／sameSite=lax／path=/ 的 cookie，導到 /my-group", async () => {
    loggedInEmail = "multi@g.nccu.edu.tw";
    expect(await switchTo(multiC)).toBe("/my-group");
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].name).toBe("ftl_identity");
    expect(setCalls[0].value).toBe(multiC);
    expect(setCalls[0].options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
    expect((await access()).active.groupId).toBe(groupC);
  });

  it("切到幹部身份 → /dashboard", async () => {
    loggedInEmail = "a1@g.nccu.edu.tw";
    const a = await access();
    const student = a.identities.find((i) => i.role === "student")!;
    expect(await switchTo(student.memberId!)).toBe("/my-group");
    expect(await switchTo(a1Officer)).toBe("/dashboard");
  });

  it("管理員身份 → /admin（ADMIN_EMAILS 的 admin@g.nccu.edu.tw）", async () => {
    loggedInEmail = "admin@g.nccu.edu.tw";
    expect(await switchTo("admin")).toBe("/admin");
    expect(setCalls[0].value).toBe("admin");
  });

  it("別人的身份 id／不存在的 id：不設定 cookie，導回目前身份的首頁", async () => {
    loggedInEmail = "multi@g.nccu.edu.tw";
    jar.set("ftl_identity", { value: multiC });
    expect(await switchTo(a1Officer)).toBe("/my-group");
    expect(await switchTo("admin")).toBe("/my-group");
    expect(await switchTo("nope")).toBe("/my-group");
    expect(setCalls).toEqual([]);
    expect(jar.get("ftl_identity")!.value).toBe(multiC);
  });
});
