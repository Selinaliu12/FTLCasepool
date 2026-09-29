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
  // 最終審查 I2：本學期還沒匯入名單就先用「新增成員」加人，之後 importRoster 會因為已經有成員列
  // 而永遠拒絕匯入（移除只是標已離開，列還在）。所以名單還沒匯入之前不能新增。
  it("本學期還沒有任何成員列（還沒匯入名單）→ 請先匯入名單，不寫入", async () => {
    const db = service();
    await db.from("pm_assignments").delete().not("group_id", "is", null);
    const { error } = await db.from("members").delete().eq("semester_id", seed.semesterId);
    expect(error).toBeNull();

    const res = await addMember({ email: "first@g.nccu.edu.tw", name: "第一人", role: "其他幹部" });
    expect(res).toEqual({ ok: false, error: "請先匯入名單，再用「新增成員」補人" });
    expect(await rowsOf("first@g.nccu.edu.tw")).toEqual([]);
  });

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

// Task 7 folded-in fixes（Task 5／6 review）：(b) 先查「已經有這個身份」再查一致性；(c) 函式自己
// 正規化並檢查信箱；(d) 恢復／新增時同一信箱所有列的姓名／學號／系級一起更新；(e)
// member_has_records() 的學期字首用字面比較，學期名稱裡有 % _ / 不會多比到。
describe("admin_add_member() folded fixes", () => {
  function rpcAdd(p: { email: string; name: string; role: string; group?: string | null; sid?: string | null; dept?: string | null }) {
    return service().rpc("admin_add_member", {
      p_semester_id: seed.semesterId, p_email: p.email, p_name: p.name, p_role: p.role,
      p_student_id: p.sid ?? null, p_dept_year: p.dept ?? null, p_group_id: p.group ?? null,
    });
  }

  it("(b) 已經有這個身份（且沒離開）→ 就算姓名不一致，也回「這個人已經有這個身份」", async () => {
    expect(await addMember({ email: "a1@g.nccu.edu.tw", name: "別的名字", role: "專案生", groupId: seed.groupA })).toEqual({
      ok: false,
      error: "這個人已經有這個身份",
    });
  });

  it("(c) 函式自己正規化信箱（去空白、小寫），也自己擋非學校信箱", async () => {
    const ok = await rpcAdd({ email: "  New9@G.NCCU.edu.tw ", name: "新九", role: "officer" });
    expect(ok.error).toBeNull();
    expect(await rowsOf("new9@g.nccu.edu.tw")).toHaveLength(1);
    const again = await rpcAdd({ email: "NEW9@g.nccu.edu.tw", name: "新九", role: "officer" });
    expect(again.error?.message).toBe("這個人已經有這個身份");
    const bad = await rpcAdd({ email: "x@gmail.com", name: "某人", role: "officer" });
    expect(bad.error?.message).toBe("email 必須是 @g.nccu.edu.tw");
  });

  it("(d) 重新加回時，同一信箱所有列（含還是已離開的其他身份）的姓名／學號／系級一起更新", async () => {
    await addMember({ email: "b1@g.nccu.edu.tw", name: "乙一", role: "其他幹部" });
    await service().from("members").update({ left_at: new Date().toISOString() }).eq("email", "b1@g.nccu.edu.tw");
    const res = await addMember({
      email: "b1@g.nccu.edu.tw", name: "乙一新", role: "專案生", studentId: "222", deptYear: "財管三", groupId: seed.groupB,
    });
    expect(res).toMatchObject({ ok: true, restored: true });
    const rows = await rowsOf("b1@g.nccu.edu.tw");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.name, r.student_id, r.dept_year])).toEqual([
      ["乙一新", "222", "財管三"],
      ["乙一新", "222", "財管三"],
    ]);
    // 另一個身份仍是已離開（只恢復這一個身份）
    expect(rows.filter((r) => r.left_at === null).map((r) => r.role)).toEqual(["student"]);
  });
});

describe("member_has_records()（e）", () => {
  it("學期名稱含 % _ 時，只有字首真的相同的上傳票才算本學期的紀錄", async () => {
    const db = service();
    await db.from("semesters").update({ name: "1%_" }).eq("id", seed.semesterId);
    await db.from("upload_tickets").insert({ key: "19x/other/x.pdf", issuer_email: "a2@g.nccu.edu.tw" });
    expect((await db.rpc("member_has_records", { p_semester_id: seed.semesterId, p_email: "a2@g.nccu.edu.tw" })).data).toBe(false);
    await db.from("upload_tickets").insert({ key: "1%_/g/y.pdf", issuer_email: "a2@g.nccu.edu.tw" });
    expect((await db.rpc("member_has_records", { p_semester_id: seed.semesterId, p_email: "a2@g.nccu.edu.tw" })).data).toBe(true);
  });

  it("學期名稱含 / 時，不會比到名稱只是它字首的別學期", async () => {
    const db = service();
    await db.from("semesters").update({ name: "115/1" }).eq("id", seed.semesterId);
    await db.from("upload_tickets").insert({ key: "115/10/x.pdf", issuer_email: "a2@g.nccu.edu.tw" });
    expect((await db.rpc("member_has_records", { p_semester_id: seed.semesterId, p_email: "a2@g.nccu.edu.tw" })).data).toBe(false);
  });
});
