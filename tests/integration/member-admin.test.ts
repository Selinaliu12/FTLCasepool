import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, service, clientAs, asPm, asAdminNoMember, okAccess } from "./helpers";

// Task 5（規格 §16）：管理員新增一個人（或替已在名單上的人加一個身份）。寫入走 SECURITY DEFINER
// 函式 admin_add_member()（只給 service_role），動作 addMember() 先確認目前身份是管理員。
const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function addMember(input: Partial<{ email: string; name: string; role: string; studentId: string; deptYear: string; groupId: string }>) {
  const { addMember } = await import("@/server/actions/admin");
  return addMember({ email: "", name: "", role: "專案生", studentId: "", deptYear: "", groupId: "", ...input });
}

async function rowsOf(email: string) {
  const { data, error } = await service()
    .from("members")
    .select("id, name, role, group_id, student_id, dept_year, left_at")
    .eq("email", email)
    .order("role");
  if (error) throw error;
  return data ?? [];
}

let seed: Awaited<ReturnType<typeof seedSemester>>;

beforeEach(async () => {
  mockGetAccess.mockReset();
  await resetDb();
  seed = await seedSemester({ acknowledged: true });
  asAdminNoMember(mockGetAccess, seed.semesterId);
});

describe("addMember", () => {
  it("新增一個專案生後，本人能登入並看到自己組", async () => {
    const res = await addMember({
      email: " New@G.nccu.edu.tw ", name: "新同學", role: "專案生", studentId: "113701001", deptYear: "資科一", groupId: seed.groupB,
    });
    expect(res).toMatchObject({ ok: true, restored: false });

    const rows = await rowsOf("new@g.nccu.edu.tw");
    expect(rows).toMatchObject([{ name: "新同學", role: "student", group_id: seed.groupB, student_id: "113701001", dept_year: "資科一", left_at: null }]);

    const db = await clientAs("new@g.nccu.edu.tw");
    const { data: groups } = await db.from("groups").select("id, name");
    expect(groups).toEqual([{ id: seed.groupB, name: "第2組" }]);
  });

  it("新增幹部：沒有組別", async () => {
    const res = await addMember({ email: "boss@g.nccu.edu.tw", name: "新幹部", role: "專案幹部" });
    expect(res.ok).toBe(true);
    expect(await rowsOf("boss@g.nccu.edu.tw")).toMatchObject([{ role: "pm", group_id: null }]);
  });

  it("替既有的人加一個身份：姓名／學號／系級一致才可以", async () => {
    // seed 的 a1（甲一，學號／系級都是 null）
    const bad = await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一一", role: "專案生", groupId: seed.groupB });
    expect(bad).toEqual({ ok: false, error: "同一個信箱的姓名／學號／系級要一致" });
    const badId = await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", studentId: "999", role: "專案生", groupId: seed.groupB });
    expect(badId).toEqual({ ok: false, error: "同一個信箱的姓名／學號／系級要一致" });
    expect(await rowsOf("a1@g.nccu.edu.tw")).toHaveLength(1);

    const good = await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", role: "其他幹部" });
    expect(good.ok).toBe(true);
    expect((await rowsOf("a1@g.nccu.edu.tw")).map((r) => r.role).sort()).toEqual(["officer", "student"]);
  });

  it("已經有這個身份（沒離開）→ 這個人已經有這個身份", async () => {
    expect(await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", role: "專案生", groupId: seed.groupA })).toEqual({
      ok: false,
      error: "這個人已經有這個身份",
    });
    expect(await addMember({ email: "off@g.nccu.edu.tw", name: "其他幹部", role: "其他幹部" })).toEqual({
      ok: false,
      error: "這個人已經有這個身份",
    });
  });

  it("已離開的身份再新增 → 恢復原列（id 不變），姓名／學號／系級更新", async () => {
    const [before] = await rowsOf("b1@g.nccu.edu.tw");
    await service().from("members").update({ left_at: new Date().toISOString() }).eq("id", before.id);

    const res = await addMember({
      email: "b1@g.nccu.edu.tw", name: "乙一改", role: "專案生", studentId: "111", deptYear: "財管二", groupId: seed.groupB,
    });
    expect(res).toMatchObject({ ok: true, restored: true });

    const after = await rowsOf("b1@g.nccu.edu.tw");
    expect(after).toEqual([
      { id: before.id, name: "乙一改", role: "student", group_id: seed.groupB, student_id: "111", dept_year: "財管二", left_at: null },
    ]);
  });

  it("一致性只跟這個人「還在」的身份比：已離開的列姓名不同不影響", async () => {
    await service().from("members").update({ left_at: new Date().toISOString() }).eq("email", "b1@g.nccu.edu.tw");
    const res = await addMember({ email: "b1@g.nccu.edu.tw", name: "乙一新名", role: "其他幹部" });
    expect(res.ok).toBe(true);
  });

  it("組別必須是本學期的", async () => {
    const db = service();
    const { data: old } = await db.from("semesters").insert({ name: "114-2", is_current: false }).select().single();
    const { data: oldGroup } = await db.from("groups").insert({ semester_id: old!.id, name: "第9組", project_name: null }).select().single();
    const res = await addMember({ email: "x@g.nccu.edu.tw", name: "某人", role: "專案生", groupId: oldGroup!.id as string });
    expect(res).toEqual({ ok: false, error: "組別不屬於本學期" });
    expect(await rowsOf("x@g.nccu.edu.tw")).toHaveLength(0);
  });

  it("欄位規則同名單 CSV，錯誤文字照 Global Constraints", async () => {
    expect(await addMember({ email: "x@gmail.com", name: "某人", role: "其他幹部" })).toEqual({ ok: false, error: "email 必須是 @g.nccu.edu.tw" });
    expect(await addMember({ email: "x@g.nccu.edu.tw", name: "某人", role: "專案生" })).toEqual({ ok: false, error: "專案生要選組別" });
    expect(await addMember({ email: "x@g.nccu.edu.tw", name: "某人", role: "其他幹部", groupId: seed.groupA })).toEqual({
      ok: false,
      error: "幹部不能填組別",
    });
  });

  it("非管理員呼叫被拒（專案幹部；管理員但目前身份切成名單身份）", async () => {
    asPm(mockGetAccess, seed.semesterId);
    await expect(addMember({ email: "x@g.nccu.edu.tw", name: "某人", role: "其他幹部" })).rejects.toThrow("只有系統管理員可以這樣做");

    mockGetAccess.mockResolvedValue(
      (() => {
        const a = okAccess({
          kind: "ok",
          email: "admin@g.nccu.edu.tw",
          isAdmin: true,
          member: { id: "m-off", semesterId: seed.semesterId, email: "admin@g.nccu.edu.tw", name: "兼幹部", role: "officer", groupId: null },
          semesterId: seed.semesterId,
        });
        if (a.kind !== "ok") throw new Error("unreachable");
        return { ...a, active: a.identities.find((i) => i.role === "officer")! };
      })()
    );
    await expect(addMember({ email: "x@g.nccu.edu.tw", name: "某人", role: "其他幹部" })).rejects.toThrow("只有系統管理員可以這樣做");
    expect(await rowsOf("x@g.nccu.edu.tw")).toHaveLength(0);
  });

  it("admin_add_member() 只給 service_role：登入的使用者（連幹部）直接呼叫會被拒", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { error } = await db.rpc("admin_add_member", {
      p_semester_id: seed.semesterId, p_email: "evil@g.nccu.edu.tw", p_name: "壞人", p_role: "pm",
      p_student_id: null, p_dept_year: null, p_group_id: null,
    });
    expect(error).not.toBeNull();
    expect(await rowsOf("evil@g.nccu.edu.tw")).toHaveLength(0);
  });
});
