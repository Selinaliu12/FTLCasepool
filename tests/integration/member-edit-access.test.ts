import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, service } from "./helpers";

// Task 6：改信箱之後，用真的 getAccess()（不 mock @/server/session，跟 member-left.test.ts 同一個
// 模式）確認新信箱能解出這個人所有身份、舊信箱變成不在名單上。直接呼叫 admin_change_email()
// RPC（changeEmail() server action 實際上就是驗證過後呼叫同一個函式），避免跟 @/server/session
// 的 mock 互相打架。

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

let seed: Awaited<ReturnType<typeof seedSemester>>;

beforeEach(async () => {
  await resetDb();
  seed = await seedSemester({ acknowledged: true });
});

describe("changeEmail 之後的 getAccess", () => {
  it("新信箱能解出所有身份，舊信箱變成不在名單上", async () => {
    expect((await getAccessAs("pm@g.nccu.edu.tw")).kind).toBe("ok");

    const { error } = await service().rpc("admin_change_email", {
      p_semester_id: seed.semesterId,
      p_old_email: "pm@g.nccu.edu.tw",
      p_new_email: "pm-new@g.nccu.edu.tw",
    });
    expect(error).toBeNull();

    const newAccess = await getAccessAs("pm-new@g.nccu.edu.tw");
    expect(newAccess.kind).toBe("ok");
    if (newAccess.kind === "ok") {
      expect(newAccess.identities.map((i) => i.role)).toEqual(["pm"]);
    }

    const oldAccess = await getAccessAs("pm@g.nccu.edu.tw");
    expect(oldAccess.kind).toBe("not_in_roster");
  });

  it("多重身份的人改信箱後，新信箱解出全部身份", async () => {
    await service().from("members").insert({
      semester_id: seed.semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "student", group_id: seed.groupA,
      student_id: null, dept_year: null,
    });

    const { error } = await service().rpc("admin_change_email", {
      p_semester_id: seed.semesterId,
      p_old_email: "off@g.nccu.edu.tw",
      p_new_email: "off-new@g.nccu.edu.tw",
    });
    expect(error).toBeNull();

    const newAccess = await getAccessAs("off-new@g.nccu.edu.tw");
    expect(newAccess.kind).toBe("ok");
    if (newAccess.kind === "ok") {
      expect(newAccess.identities.map((i) => i.role).sort()).toEqual(["officer", "student"]);
    }
  });
});
