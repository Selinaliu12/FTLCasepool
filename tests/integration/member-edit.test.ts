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

  it("新信箱格式不對", async () => {
    expect(await changeEmail("pm@g.nccu.edu.tw", "pm@gmail")).toEqual({
      ok: false,
      error: "email 格式不正確",
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

  // F3（fix round 1）：正規化後新舊信箱是同一個，不當成「已經在名單上」，直接算成功、不動資料。
  it("新舊信箱正規化後相同 → 直接成功（no-op）", async () => {
    const res = await changeEmail(" PM@G.NCCU.EDU.TW ", "pm@g.nccu.edu.tw ");
    expect(res).toEqual({ ok: true });
    expect(await rowsOf("pm@g.nccu.edu.tw")).toHaveLength(1);
  });

  // F8（fix round 1）：改信箱後，acknowledgements（「我已了解」）跟著搬到新信箱，不會讓這個人
  // 又被送回 /welcome。
  it("acknowledgement 跟著搬到新信箱，舊信箱的那筆消失", async () => {
    await changeEmail("pm@g.nccu.edu.tw", "pm-new@g.nccu.edu.tw");
    const db = service();
    const { data: oldAck } = await db.from("acknowledgements").select("*").eq("email", "pm@g.nccu.edu.tw");
    expect(oldAck).toHaveLength(0);
    const { data: newAck } = await db
      .from("acknowledgements")
      .select("*")
      .eq("semester_id", seed.semesterId)
      .eq("email", "pm-new@g.nccu.edu.tw");
    expect(newAck).toHaveLength(1);
  });
});

// F4（fix round 1）：「有紀錄」檢查至少再測 3 個 progress_reports／checkins 以外的欄位，包含
// stage_submissions 的一欄與 upload_tickets.issuer_email。F5：紀錄檢查只看本學期，其他學期的
// 紀錄不能卡住這學期改信箱。
describe("changeEmail：舊信箱有紀錄（F4／F5）", () => {
  async function makeLineAndGroup(semesterId: string, groupName: string) {
    const db = service();
    const { data: group, error: gErr } = await db
      .from("groups")
      .insert({ semester_id: semesterId, name: groupName, project_name: null })
      .select()
      .single();
    if (gErr) throw gErr;
    const { data: line, error: lErr } = await db.from("lines").insert({ group_id: group!.id, kind: "project" }).select().single();
    if (lErr) throw lErr;
    return { groupId: group!.id as string, lineId: line!.id as string };
  }

  it("stage_submissions.submitted_by 有紀錄 → 被拒", async () => {
    const { lineId } = await makeLineAndGroup(seed.semesterId, "第9組");
    await service().from("stage_submissions").insert({
      line_id: lineId, stage: "signup", version: 1, pdf_key: "stages/f4/signup1.pdf", pdf_size: 10,
      pdf_uploaded_at: new Date().toISOString(), pdf_uploaded_by: "a2@g.nccu.edu.tw", submitted_by: "a2@g.nccu.edu.tw",
    });
    expect(await changeEmail("a2@g.nccu.edu.tw", "a2-new@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增",
    });
  });

  it("stage_submissions.reviewed_by 有紀錄 → 被拒", async () => {
    const { lineId } = await makeLineAndGroup(seed.semesterId, "第9組");
    await service().from("stage_submissions").insert({
      line_id: lineId, stage: "signup", version: 1, pdf_key: "stages/f4/signup2.pdf", pdf_size: 10,
      pdf_uploaded_at: new Date().toISOString(), pdf_uploaded_by: "a1@g.nccu.edu.tw", submitted_by: "a1@g.nccu.edu.tw",
      reviewed_by: "off@g.nccu.edu.tw",
    });
    expect(await changeEmail("off@g.nccu.edu.tw", "off-new@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增",
    });
  });

  it("upload_tickets.issuer_email 有本學期的票 → 被拒", async () => {
    const { data: semester } = await service().from("semesters").select("name").eq("id", seed.semesterId).single();
    await service().from("upload_tickets").insert({
      key: `${semester!.name}/${seed.groupB}/f4-ticket.pdf`, issuer_email: "a2@g.nccu.edu.tw",
    });
    expect(await changeEmail("a2@g.nccu.edu.tw", "a2-new@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增",
    });
  });

  it("competition_entries.created_by 有紀錄 → 被拒", async () => {
    const db = service();
    const { data: comp, error: cErr } = await db
      .from("competitions")
      .insert({ semester_id: seed.semesterId, name: "F4盃", url: "https://example.com", signup_deadline: new Date().toISOString(), created_by: "off@g.nccu.edu.tw", status: "published" })
      .select()
      .single();
    if (cErr) throw cErr;
    await db.from("competition_entries").insert({ group_id: seed.groupA, competition_id: comp!.id, created_by: "a2@g.nccu.edu.tw" });
    expect(await changeEmail("a2@g.nccu.edu.tw", "a2-new@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增",
    });
  });

  it("competitions.created_by 有紀錄 → 被拒", async () => {
    await service()
      .from("competitions")
      .insert({ semester_id: seed.semesterId, name: "F4盃2", url: "https://example.com", signup_deadline: new Date().toISOString(), created_by: "off@g.nccu.edu.tw", status: "draft" });
    expect(await changeEmail("off@g.nccu.edu.tw", "off-new@g.nccu.edu.tw")).toEqual({
      ok: false,
      error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增",
    });
  });

  // F5：其他學期留下的紀錄不能擋住這學期改信箱。
  it("紀錄檢查只看本學期：舊學期的 progress_reports／checkins 不擋這學期改信箱", async () => {
    const db = service();
    const { data: oldSemester, error: sErr } = await db.from("semesters").insert({ name: "114-2", is_current: false }).select().single();
    if (sErr) throw sErr;
    const { lineId: oldLineId } = await makeLineAndGroup(oldSemester!.id as string, "舊第1組");
    const { data: oldPeriod, error: pErr } = await db
      .from("periods")
      .insert({ semester_id: oldSemester!.id, seq: 1, deadline: "2025-10-01T00:00:00Z" })
      .select()
      .single();
    if (pErr) throw pErr;
    await db.from("progress_reports").insert({
      line_id: oldLineId, period_id: oldPeriod!.id, light: "green", did: "x", blocked: "無", next_steps: "x",
      submitted_by: "a2@g.nccu.edu.tw", pdf_key: "reports/f5/old-period1.pdf", pdf_size: 10,
      pdf_uploaded_at: new Date().toISOString(), pdf_uploaded_by: "a2@g.nccu.edu.tw",
    });
    await db.from("checkins").insert({ line_id: oldLineId, light: "red", note: "舊的", created_by: "a2@g.nccu.edu.tw" });

    // a2 在「這學期」沒有任何紀錄（seedSemester 只給 a1、b1 留紀錄），只有上面剛塞進「舊學期」的。
    expect(await changeEmail("a2@g.nccu.edu.tw", "a2-fixed@g.nccu.edu.tw")).toEqual({ ok: true });
  });

  it("F5：舊學期的 upload_tickets（key 字首是舊學期名稱）不擋這學期改信箱", async () => {
    const db = service();
    const { data: oldSemester, error: sErr } = await db.from("semesters").insert({ name: "114-2b", is_current: false }).select().single();
    if (sErr) throw sErr;
    await db.from("upload_tickets").insert({ key: `${oldSemester!.name}/some-group/old-ticket.pdf`, issuer_email: "a2@g.nccu.edu.tw" });
    expect(await changeEmail("a2@g.nccu.edu.tw", "a2-fixed2@g.nccu.edu.tw")).toEqual({ ok: true });
  });
});

// F1（fix round 1）：姓名／學號／系級／信箱一次一個 server action、一個 SQL 交易寫完
// （editPerson() → admin_edit_person()），取代「先 changeEmail 再 updatePerson」的兩段式寫法。
describe("editPerson", () => {
  async function editPerson(
    oldEmail: string,
    newEmail: string,
    fields: Partial<{ name: string; studentId: string; deptYear: string }>
  ) {
    const { editPerson } = await import("@/server/actions/admin");
    return editPerson(oldEmail, newEmail, { name: "", studentId: "", deptYear: "", ...fields });
  }

  it("姓名／學號／系級／信箱一次改完，所有身份一起改", async () => {
    // a2（不是 a1）：a1 在 seedSemester 留有交件紀錄，這個案例要測「沒有紀錄、真的能改信箱」。
    await service().from("members").insert({
      semester_id: seed.semesterId, email: "a2@g.nccu.edu.tw", name: "甲二", role: "officer", group_id: null,
    });

    const res = await editPerson("a2@g.nccu.edu.tw", "a2-new@g.nccu.edu.tw", {
      name: "甲二改", studentId: "112701001", deptYear: "資科二",
    });
    expect(res).toEqual({ ok: true });

    expect(await rowsOf("a2@g.nccu.edu.tw")).toHaveLength(0);
    const rows = await rowsOf("a2-new@g.nccu.edu.tw");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.name).toBe("甲二改");
      expect(r.student_id).toBe("112701001");
      expect(r.dept_year).toBe("資科二");
    }
  });

  // 這是 F1 明確要求的測試：姓名清空、信箱同時改 → 顯示錯誤、什麼都沒被改動（一個交易，
  // 不會出現「信箱改了、姓名沒改」的半吊子狀態）。
  it("姓名清空、同時改信箱 → 錯誤，信箱與姓名都沒被改動", async () => {
    const before = await rowsOf("a2@g.nccu.edu.tw");
    const res = await editPerson("a2@g.nccu.edu.tw", "a2-new@g.nccu.edu.tw", { name: "   ", studentId: "999" });
    expect(res).toEqual({ ok: false, error: "姓名不能空白" });

    expect(await rowsOf("a2-new@g.nccu.edu.tw")).toHaveLength(0);
    const after = await rowsOf("a2@g.nccu.edu.tw");
    expect(after).toEqual(before);
  });

  it("新信箱網域不對 → 錯誤，什麼都沒被改動", async () => {
    const before = await rowsOf("a2@g.nccu.edu.tw");
    const res = await editPerson("a2@g.nccu.edu.tw", "a2@gmail", { name: "甲二改" });
    expect(res).toEqual({ ok: false, error: "email 格式不正確" });
    expect(await rowsOf("a2@g.nccu.edu.tw")).toEqual(before);
  });

  it("找不到這個人", async () => {
    expect(await editPerson("nobody@g.nccu.edu.tw", "nobody-new@g.nccu.edu.tw", { name: "某人" })).toEqual({
      ok: false,
      error: "找不到這個人",
    });
  });

  it("新信箱已在名單上 → 錯誤，什麼都沒被改動", async () => {
    const before = await rowsOf("a2@g.nccu.edu.tw");
    const res = await editPerson("a2@g.nccu.edu.tw", "a1@g.nccu.edu.tw", { name: "甲二改" });
    expect(res).toEqual({ ok: false, error: "這個信箱已經在本學期名單上" });
    expect(await rowsOf("a2@g.nccu.edu.tw")).toEqual(before);
  });

  it("舊信箱已有紀錄時改信箱 → 錯誤，什麼都沒被改動（姓名也不會被改）", async () => {
    const before = await rowsOf("a1@g.nccu.edu.tw");
    const res = await editPerson("a1@g.nccu.edu.tw", "a1-new@g.nccu.edu.tw", { name: "甲一改" });
    expect(res).toEqual({ ok: false, error: "這個人已經有紀錄，不能改信箱；請移除後用新信箱新增" });
    expect(await rowsOf("a1@g.nccu.edu.tw")).toEqual(before);
  });

  // F3：同信箱（正規化後相同）＝沒有要換信箱，直接視為成功；姓名等欄位照樣更新。
  it("信箱不變（正規化後相同）只改姓名 → 成功，no-op 在信箱這件事上", async () => {
    const res = await editPerson("a2@g.nccu.edu.tw", " A2@G.NCCU.EDU.TW ", { name: "甲二改" });
    expect(res).toEqual({ ok: true });
    const [row] = await rowsOf("a2@g.nccu.edu.tw");
    expect(row.name).toBe("甲二改");
  });

  it("學號／系級留空存成 null", async () => {
    await editPerson("a2@g.nccu.edu.tw", "a2@g.nccu.edu.tw", { name: "甲二", studentId: "", deptYear: "" });
    const [row] = await rowsOf("a2@g.nccu.edu.tw");
    expect(row.student_id).toBeNull();
    expect(row.dept_year).toBeNull();
  });

  it("非管理員被拒", async () => {
    asPm(mockGetAccess, seed.semesterId);
    await expect(editPerson("a2@g.nccu.edu.tw", "a2-new@g.nccu.edu.tw", { name: "甲二改" })).rejects.toThrow(
      "只有系統管理員可以這樣做"
    );
    expect(await rowsOf("a2-new@g.nccu.edu.tw")).toHaveLength(0);
  });

  it("admin_edit_person() 只給 service_role：登入的使用者直接呼叫會被拒", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { error } = await db.rpc("admin_edit_person", {
      p_semester_id: seed.semesterId, p_old_email: "a2@g.nccu.edu.tw", p_new_email: "evil@g.nccu.edu.tw",
      p_name: "壞改名", p_student_id: null, p_dept_year: null,
    });
    expect(error).not.toBeNull();
    expect(await rowsOf("a2@g.nccu.edu.tw")).toHaveLength(1);
  });

  it("acknowledgement 跟著改信箱一起搬到新信箱", async () => {
    await editPerson("pm@g.nccu.edu.tw", "pm-new@g.nccu.edu.tw", { name: "專案幹部" });
    const db = service();
    const { data: oldAck } = await db.from("acknowledgements").select("*").eq("email", "pm@g.nccu.edu.tw");
    expect(oldAck).toHaveLength(0);
    const { data: newAck } = await db.from("acknowledgements").select("*").eq("semester_id", seed.semesterId).eq("email", "pm-new@g.nccu.edu.tw");
    expect(newAck).toHaveLength(1);
  });
});
