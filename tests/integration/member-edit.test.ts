import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, service, clientAs, asPm, asAdminNoMember } from "./helpers";

// Task 6（規格 §16 第 3、4 點）：管理員改姓名／學號／系級（updatePerson），以及改信箱
// （changeEmail）。都以「人」為單位——同一信箱本學期所有身份列（還在或已離開）一起改。寫入走
// SECURITY DEFINER 函式（只給 service_role），動作先確認目前身份是管理員。
const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function updatePerson(email: string, fields: Partial<{ name: string; studentId: string; deptYear: string }>) {
  const { updatePerson } = await import("@/server/actions/admin");
  return updatePerson(email, { name: "", studentId: "", deptYear: "", ...fields });
}

async function changeEmail(oldEmail: string, newEmail: string) {
  const { changeEmail } = await import("@/server/actions/admin");
  return changeEmail(oldEmail, newEmail);
}

async function rowsOf(email: string) {
  const { data, error } = await service()
    .from("members")
    .select("id, email, name, role, group_id, student_id, dept_year, left_at")
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

describe("updatePerson", () => {
  it("改姓名／學號／系級 → 同一信箱的所有身份一起改", async () => {
    // a1 只有一個身份；先替它加一個幹部身份，確認兩列都被改到。
    await service().from("members").insert({
      semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "officer", group_id: null,
    });

    const res = await updatePerson("a1@g.nccu.edu.tw", { name: "甲一改", studentId: "112701001", deptYear: "資科二" });
    expect(res).toEqual({ ok: true });

    const rows = await rowsOf("a1@g.nccu.edu.tw");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.name).toBe("甲一改");
      expect(r.student_id).toBe("112701001");
      expect(r.dept_year).toBe("資科二");
    }
  });

  it("同一信箱已離開的身份也一起改名字", async () => {
    const [before] = await rowsOf("b1@g.nccu.edu.tw");
    await service().from("members").update({ left_at: new Date().toISOString() }).eq("id", before.id);

    const res = await updatePerson("b1@g.nccu.edu.tw", { name: "乙一改" });
    expect(res).toEqual({ ok: true });

    const [after] = await rowsOf("b1@g.nccu.edu.tw");
    expect(after.name).toBe("乙一改");
    expect(after.left_at).not.toBeNull();
  });

  it("姓名去空白後不能空白", async () => {
    expect(await updatePerson("a1@g.nccu.edu.tw", { name: "  " })).toEqual({ ok: false, error: "姓名不能空白" });
  });

  it("學號／系級留空存成 null", async () => {
    await updatePerson("a1@g.nccu.edu.tw", { name: "甲一", studentId: "", deptYear: "" });
    const [row] = await rowsOf("a1@g.nccu.edu.tw");
    expect(row.student_id).toBeNull();
    expect(row.dept_year).toBeNull();
  });

  it("找不到這個信箱", async () => {
    expect(await updatePerson("nobody@g.nccu.edu.tw", { name: "某人" })).toEqual({ ok: false, error: "找不到這個人" });
  });

  it("非管理員被拒", async () => {
    asPm(mockGetAccess, seed.semesterId);
    await expect(updatePerson("a1@g.nccu.edu.tw", { name: "甲一改" })).rejects.toThrow("只有系統管理員可以這樣做");
    expect((await rowsOf("a1@g.nccu.edu.tw"))[0].name).toBe("甲一");
  });

  it("admin_update_person() 只給 service_role：登入的使用者直接呼叫會被拒", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { error } = await db.rpc("admin_update_person", {
      p_semester_id: seed.semesterId, p_email: "a1@g.nccu.edu.tw", p_name: "壞改名", p_student_id: null, p_dept_year: null,
    });
    expect(error).not.toBeNull();
    expect((await rowsOf("a1@g.nccu.edu.tw"))[0].name).toBe("甲一");
  });
});

describe("changeEmail", () => {
  it("改信箱 → 所有身份一起改，新信箱能登入、舊信箱不能", async () => {
    // pm 沒有任何交件／上傳／審核紀錄（seedSemester 只給 a1、b1 留紀錄）。
    const res = await changeEmail("pm@g.nccu.edu.tw", "pm-new@g.nccu.edu.tw");
    expect(res).toEqual({ ok: true });

    expect(await rowsOf("pm@g.nccu.edu.tw")).toHaveLength(0);
    const rows = await rowsOf("pm-new@g.nccu.edu.tw");
    expect(rows).toMatchObject([{ role: "pm", left_at: null }]);
  });

  it("新信箱已在名單上被拒", async () => {
    expect(await changeEmail("pm@g.nccu.edu.tw", "a1@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個信箱已經在本學期名單上",
    });
    expect(await rowsOf("pm@g.nccu.edu.tw")).toHaveLength(1);
  });

  it("新信箱已在名單上（已離開的列也算）被拒", async () => {
    const [off] = await rowsOf("off@g.nccu.edu.tw");
    await service().from("members").update({ left_at: new Date().toISOString() }).eq("id", off.id);
    expect(await changeEmail("pm@g.nccu.edu.tw", "off@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個信箱已經在本學期名單上",
    });
  });

  it("舊信箱已有交件紀錄被拒", async () => {
    // a1：progress_reports.submitted_by／pdf_uploaded_by、checkins.created_by 都有紀錄。
    expect(await changeEmail("a1@g.nccu.edu.tw", "a1-new@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增",
    });
    expect(await rowsOf("a1@g.nccu.edu.tw")).toHaveLength(1);
  });

  it("舊信箱只有 checkins 紀錄也被拒（b1）", async () => {
    expect(await changeEmail("b1@g.nccu.edu.tw", "b1-new@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增",
    });
  });

  it("信箱打錯、從來沒登入過、沒有紀錄的人不受影響", async () => {
    // a2 在 seedSemester 沒有留下任何交件／上傳紀錄。
    expect(await changeEmail("a2@g.nccu.edu.tw", "a2-fixed@g.nccu.edu.tw")).toEqual({ ok: true });
    expect(await rowsOf("a2-fixed@g.nccu.edu.tw")).toHaveLength(1);
  });

  it("新信箱網域不對", async () => {
    expect(await changeEmail("pm@g.nccu.edu.tw", "pm@gmail.com")).toEqual({
      ok: false,
      error: "email 必須是 @g.nccu.edu.tw",
    });
  });

  it("正規化：trim + lowercase", async () => {
    const res = await changeEmail(" PM@G.NCCU.EDU.TW ", " PM-NEW@G.NCCU.EDU.TW ");
    expect(res).toEqual({ ok: true });
    expect(await rowsOf("pm-new@g.nccu.edu.tw")).toHaveLength(1);
  });

  it("非管理員被拒", async () => {
    asPm(mockGetAccess, seed.semesterId);
    await expect(changeEmail("off@g.nccu.edu.tw", "off-new@g.nccu.edu.tw")).rejects.toThrow("只有系統管理員可以這樣做");
    expect(await rowsOf("off@g.nccu.edu.tw")).toHaveLength(1);
  });

  it("admin_change_email() 只給 service_role：登入的使用者直接呼叫會被拒", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { error } = await db.rpc("admin_change_email", {
      p_semester_id: seed.semesterId, p_old_email: "off@g.nccu.edu.tw", p_new_email: "evil@g.nccu.edu.tw",
    });
    expect(error).not.toBeNull();
    expect(await rowsOf("off@g.nccu.edu.tw")).toHaveLength(1);
  });
});
