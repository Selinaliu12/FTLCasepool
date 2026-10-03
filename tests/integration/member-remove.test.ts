import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, service, clientAs } from "./helpers";

// Task 7（規格 §16 第 5、6 點）：管理員移除某個身份或整個人＝軟移除（members.left_at），不刪列。
// 這裡用「真的」getAccess()：只替換「誰登入」（auth.getUser 來自 clientAs 登入的本機測試帳號，
// 所以查詢也真的走 RLS）與 cookie store（ftl_identity）。管理員就是 ADMIN_EMAILS 裡的
// admin@g.nccu.edu.tw（不在名單上，目前身份＝管理員）。
let loggedInEmail = "";
let identityCookie: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "ftl_identity" && identityCookie ? { name, value: identityCookie } : undefined),
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  const { clientAs: signIn } = await import("./helpers");
  return { ...actual, createServerSupabase: async () => signIn(loggedInEmail) };
});

async function as<T>(email: string, fn: () => Promise<T>, cookie?: string): Promise<T> {
  loggedInEmail = email;
  identityCookie = cookie;
  return fn();
}
const ADMIN = "admin@g.nccu.edu.tw";

async function access(email: string, cookie?: string) {
  const { getAccess } = await import("@/server/session");
  return as(email, () => getAccess(), cookie);
}
async function removeIdentity(memberId: string) {
  const { removeIdentity } = await import("@/server/actions/admin");
  return as(ADMIN, () => removeIdentity(memberId));
}
async function removePerson(email: string) {
  const { removePerson } = await import("@/server/actions/admin");
  return as(ADMIN, () => removePerson(email));
}
async function addMember(input: { email: string; name: string; role: string; groupId?: string; studentId?: string; deptYear?: string }) {
  const { addMember } = await import("@/server/actions/admin");
  return as(ADMIN, () => addMember({ studentId: "", deptYear: "", groupId: "", ...input }));
}
async function memberId(email: string, role = "student") {
  const { data, error } = await service().from("members").select("id").eq("email", email).eq("role", role).single();
  if (error) throw error;
  return data.id as string;
}
async function rowsOf(email: string) {
  const { data, error } = await service().from("members").select("id, role, name, left_at").eq("email", email).order("role");
  if (error) throw error;
  return data ?? [];
}

let seed: Awaited<ReturnType<typeof seedSemester>>;

beforeEach(async () => {
  loggedInEmail = "";
  identityCookie = undefined;
  await resetDb();
  seed = await seedSemester({ acknowledged: true });
});

describe("removeIdentity／removePerson", () => {
  it("只有目前身份是管理員才能移除", async () => {
    const { removeIdentity: remove, removePerson: removeAll } = await import("@/server/actions/admin");
    const target = await memberId("b1@g.nccu.edu.tw");
    await expect(as("pm@g.nccu.edu.tw", () => remove(target))).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(as("pm@g.nccu.edu.tw", () => removeAll("b1@g.nccu.edu.tw"))).rejects.toThrow("只有系統管理員可以這樣做");
    expect((await rowsOf("b1@g.nccu.edu.tw"))[0].left_at).toBeNull();
  });

  it("移除唯一的身份 → 那個人下一次請求就是名單外", async () => {
    expect((await access("b1@g.nccu.edu.tw")).kind).toBe("ok");
    expect(await removeIdentity(await memberId("b1@g.nccu.edu.tw"))).toEqual({ ok: true });
    expect((await rowsOf("b1@g.nccu.edu.tw"))[0].left_at).not.toBeNull();
    expect((await access("b1@g.nccu.edu.tw")).kind).toBe("not_in_roster");
  });

  it("只移除其中一個身份 → 其他身份照常", async () => {
    await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", role: "其他幹部" });
    await removeIdentity(await memberId("a1@g.nccu.edu.tw", "student"));
    const a = await access("a1@g.nccu.edu.tw");
    if (a.kind !== "ok") throw new Error(a.kind);
    expect(a.identities.map((i) => i.label)).toEqual(["其他幹部"]);
  });

  it("移除整個人 → 所有身份都已離開 → 名單外", async () => {
    await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", role: "其他幹部" });
    expect(await removePerson(" A1@g.nccu.edu.tw ")).toEqual({ ok: true });
    const rows = await rowsOf("a1@g.nccu.edu.tw");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.left_at !== null)).toBe(true);
    expect((await access("a1@g.nccu.edu.tw")).kind).toBe("not_in_roster");
  });

  it("已經離開的身份再移除一次 → 成功、什麼都不變", async () => {
    const id = await memberId("b1@g.nccu.edu.tw");
    await removeIdentity(id);
    const [first] = await rowsOf("b1@g.nccu.edu.tw");
    expect(await removeIdentity(id)).toEqual({ ok: true });
    expect(await removePerson("b1@g.nccu.edu.tw")).toEqual({ ok: true });
    const [second] = await rowsOf("b1@g.nccu.edu.tw");
    expect(second.left_at).toBe(first.left_at);
  });

  it("不是本學期的成員不能移除；不在名單上的人 → 找不到這個人", async () => {
    const db = service();
    const { data: old } = await db.from("semesters").insert({ name: "114-2", is_current: false }).select().single();
    const { data: oldMember } = await db
      .from("members")
      .insert({ semester_id: old!.id, email: "old@g.nccu.edu.tw", name: "舊生", role: "officer" })
      .select()
      .single();
    expect(await removeIdentity(oldMember!.id as string)).toEqual({ ok: false, error: "只能移除本學期的成員" });
    expect((await db.from("members").select("left_at").eq("id", oldMember!.id).single()).data!.left_at).toBeNull();
    expect(await removePerson("old@g.nccu.edu.tw")).toEqual({ ok: false, error: "找不到這個人" });
    expect(await removeIdentity("00000000-0000-0000-0000-000000000000")).toEqual({ ok: false, error: "找不到這個身份" });
  });

  it("SQL 函式只給 service_role", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const r1 = await db.rpc("admin_remove_identity", { p_member_id: await memberId("b1@g.nccu.edu.tw") });
    expect(r1.error).not.toBeNull();
    expect(r1.error?.code).toBe("42501");
    const r2 = await db.rpc("admin_remove_person", { p_semester_id: seed.semesterId, p_email: "b1@g.nccu.edu.tw" });
    expect(r2.error).not.toBeNull();
    expect(r2.error?.code).toBe("42501");
    expect((await rowsOf("b1@g.nccu.edu.tw"))[0].left_at).toBeNull();
  });
});

describe("cookie 指向已離開的身份（Review Focus 6）", () => {
  it("目前身份被移除 → 退回其他身份", async () => {
    await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", role: "其他幹部" });
    const studentRow = await memberId("a1@g.nccu.edu.tw", "student");
    const before = await access("a1@g.nccu.edu.tw", studentRow);
    if (before.kind !== "ok") throw new Error(before.kind);
    expect(before.active.label).toBe("第1組專案生");

    await removeIdentity(studentRow);
    const after = await access("a1@g.nccu.edu.tw", studentRow);
    if (after.kind !== "ok") throw new Error(after.kind);
    expect(after.active.label).toBe("其他幹部");
    expect(after.identities.map((i) => i.label)).toEqual(["其他幹部"]);
  });

  it("cookie 指向的是唯一的身份、已離開 → 名單外", async () => {
    const id = await memberId("b1@g.nccu.edu.tw");
    await removeIdentity(id);
    expect((await access("b1@g.nccu.edu.tw", id)).kind).toBe("not_in_roster");
  });
});

describe("RLS：已離開的身份不算進聯集", () => {
  it("已離開的專案生讀不到原本組的內容（進度、點燈、組別、組員）", async () => {
    const before = await clientAs("a1@g.nccu.edu.tw");
    expect((await before.from("progress_reports").select("id")).data).toHaveLength(1);

    await removePerson("a1@g.nccu.edu.tw");
    const db = await clientAs("a1@g.nccu.edu.tw");
    expect((await db.from("progress_reports").select("id")).data).toEqual([]);
    expect((await db.from("checkins").select("id")).data).toEqual([]);
    expect((await db.from("groups").select("id")).data).toEqual([]);
    expect((await db.from("members").select("id").eq("group_id", seed.groupA)).data).toEqual([]);
  });
});

describe("已交的紀錄保留，名字標（已離開）", () => {
  it("組別內容頁：進度仍在、準時率不變、交件人與點燈人顯示 甲一（已離開）、組員清單不列", async () => {
    const { loadGroupDetail } = await import("@/server/queries/group-detail");
    const before = await as(ADMIN, () => loadGroupDetail(seed.groupA));
    expect(before!.periods[0].report!.content!.submittedBy).toBe("甲一");

    await removePerson("a1@g.nccu.edu.tw");
    const after = await as(ADMIN, () => loadGroupDetail(seed.groupA));
    expect(after!.periods[0].report).not.toBeNull();
    expect(after!.periods[0].report!.content!.submittedBy).toBe("甲一（已離開）");
    expect(after!.onTime).toBe(before!.onTime);
    expect(after!.display).toEqual(before!.display);
    expect(after!.checkins.map((c) => c.by)).toEqual(["甲一（已離開）"]);
    expect(after!.group.members.map((m) => m.name)).toEqual(["甲二"]);
  });

  it("組員自己的組頁（走 RLS）：交件人顯示 甲一（已離開），組員清單不列", async () => {
    const { loadMyGroup } = await import("@/server/queries/my-group");
    await removePerson("a1@g.nccu.edu.tw");
    const data = await as("a2@g.nccu.edu.tw", () => loadMyGroup());
    expect(data.periods[0].report!.submittedBy).toBe("甲一（已離開）");
    expect(data.checkins.map((c) => c.by)).toEqual(["甲一（已離開）"]);
    expect(data.latestReport!.name).toBe("甲一（已離開）");
    expect(data.members.map((m) => m.name)).toEqual(["甲二"]);
  });

  it("看板卡片的組員清單不列已離開的人", async () => {
    const { loadDashboard } = await import("@/server/queries/dashboard");
    await removePerson("a1@g.nccu.edu.tw");
    const dash = await as("off@g.nccu.edu.tw", () => loadDashboard());
    const card = dash.cards.find((g) => g.groupId === seed.groupA)!;
    expect(card.members.map((m) => m.name)).toEqual(["甲二"]);
  });

  it("只移除其中一個身份（還是幹部）→ 紀錄上顯示正常姓名", async () => {
    const { loadGroupDetail } = await import("@/server/queries/group-detail");
    await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", role: "其他幹部" });
    await removeIdentity(await memberId("a1@g.nccu.edu.tw", "student"));
    const detail = await as(ADMIN, () => loadGroupDetail(seed.groupA));
    expect(detail!.periods[0].report!.content!.submittedBy).toBe("甲一");
    expect(detail!.group.members.map((m) => m.name)).toEqual(["甲二"]);
  });

  it("移除後重新加回 → 恢復原列，名字恢復正常、不會出現兩列（Review Focus 7）", async () => {
    const { loadGroupDetail } = await import("@/server/queries/group-detail");
    const id = await memberId("a1@g.nccu.edu.tw");
    await removeIdentity(id);
    const res = await addMember({ email: "a1@g.nccu.edu.tw", name: "甲一", role: "專案生", groupId: seed.groupA });
    expect(res).toMatchObject({ ok: true, restored: true, memberId: id });
    expect(await rowsOf("a1@g.nccu.edu.tw")).toHaveLength(1);
    const detail = await as(ADMIN, () => loadGroupDetail(seed.groupA));
    expect(detail!.periods[0].report!.content!.submittedBy).toBe("甲一");
    expect(detail!.group.members.map((m) => m.name)).toEqual(["甲一", "甲二"]);
    expect((await access("a1@g.nccu.edu.tw")).kind).toBe("ok");
  });
});

describe("專案幹部身份移除 → 負責組別一起清掉", () => {
  async function pendingSubmission() {
    const db = service();
    const { data: comp } = await db
      .from("competitions")
      .insert({ semester_id: seed.semesterId, name: "黑客松", url: "https://example.com", signup_deadline: "2099-10-01T15:59:59.999Z", status: "published", created_by: "pm@g.nccu.edu.tw" })
      .select()
      .single();
    const { data: entry } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: comp!.id, created_by: "a1@g.nccu.edu.tw", confirmed_at: new Date().toISOString() })
      .select()
      .single();
    const { data: line } = await db.from("lines").insert({ group_id: seed.groupA, kind: "competition", entry_id: entry!.id }).select().single();
    const { data: sub, error } = await db
      .from("stage_submissions")
      .insert({
        line_id: line!.id, stage: "signup", version: 1, pdf_key: `115-1/${seed.groupA}/s.pdf`, pdf_size: 10,
        pdf_uploaded_at: new Date(Date.now() - 3 * 3600_000).toISOString(), pdf_uploaded_by: "a1@g.nccu.edu.tw",
        submitted_by: "a1@g.nccu.edu.tw", review_status: "pending",
      })
      .select()
      .single();
    if (error) throw error;
    return sub!.id as string;
  }

  it("移除專案幹部 → pm_assignments 清掉；不能再審核、也不能再指派組別", async () => {
    const db = service();
    const pmId = await memberId("pm@g.nccu.edu.tw", "pm");
    await db.from("pm_assignments").insert([{ pm_member_id: pmId, group_id: seed.groupA }, { pm_member_id: pmId, group_id: seed.groupB }]);
    const subId = await pendingSubmission();

    expect(await removeIdentity(pmId)).toEqual({ ok: true });
    expect((await db.from("pm_assignments").select("group_id").eq("pm_member_id", pmId)).data).toEqual([]);

    const review = await db.rpc("review_stage", { p_submission_id: subId, p_reviewer: "pm@g.nccu.edu.tw", p_pm_member_id: pmId, p_decision: "approved", p_comment: null });
    expect(review.error?.message).toBe("not_assigned");

    const assign = await db.rpc("set_pm_groups", { p_pm_member_id: pmId, p_group_ids: [seed.groupA] });
    expect(assign.error?.message).toBe("這位專案幹部已離開");
  });

  it("就算殘留一筆已離開幹部的指派，也不算負責審核的人", async () => {
    const db = service();
    const pmId = await memberId("pm@g.nccu.edu.tw", "pm");
    const subId = await pendingSubmission();
    await db.from("members").update({ left_at: new Date().toISOString() }).eq("id", pmId);
    await db.from("pm_assignments").insert({ pm_member_id: pmId, group_id: seed.groupA });
    const review = await db.rpc("review_stage", { p_submission_id: subId, p_reviewer: "pm@g.nccu.edu.tw", p_pm_member_id: pmId, p_decision: "approved", p_comment: null });
    expect(review.error?.message).toBe("not_assigned");
  });

  it("移除整個人（含專案幹部身份）也清掉負責組別", async () => {
    const db = service();
    const pmId = await memberId("pm@g.nccu.edu.tw", "pm");
    await db.from("pm_assignments").insert({ pm_member_id: pmId, group_id: seed.groupA });
    expect(await removePerson("pm@g.nccu.edu.tw")).toEqual({ ok: true });
    expect((await db.from("pm_assignments").select("group_id").eq("pm_member_id", pmId)).data).toEqual([]);
  });
});

describe("參賽成員", () => {
  async function entry(confirmed: boolean) {
    const db = service();
    const { data: comp } = await db
      .from("competitions")
      .insert({ semester_id: seed.semesterId, name: `比賽${Math.random()}`, url: "https://example.com", signup_deadline: "2099-10-01T15:59:59.999Z", status: "published", created_by: "pm@g.nccu.edu.tw" })
      .select()
      .single();
    const { data: e, error } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: comp!.id, created_by: "a1@g.nccu.edu.tw", confirmed_at: confirmed ? new Date().toISOString() : null })
      .select()
      .single();
    if (error) throw error;
    return e!.id as string;
  }

  it("已離開的參賽成員仍列在名單上並標（已離開），但不在可勾選的名單裡、也不能再勾", async () => {
    const a1 = await memberId("a1@g.nccu.edu.tw");
    const a2 = await memberId("a2@g.nccu.edu.tw");
    const entryId = await entry(true);
    await service().from("entry_members").insert([{ entry_id: entryId, member_id: a1 }, { entry_id: entryId, member_id: a2 }]);

    await removeIdentity(a2);

    const { loadEntryDetail } = await import("@/server/queries/entries");
    const detail = await as("a1@g.nccu.edu.tw", () => loadEntryDetail(entryId));
    expect(detail!.groupStudents.map((s) => s.name)).toEqual(["甲一"]);
    // entry_members 沒有排序保證，不比順序。
    expect(detail!.selectedMembers).toHaveLength(2);
    expect(detail!.selectedMembers).toEqual(expect.arrayContaining([
      { id: a1, name: "甲一", movedOut: false, left: false },
      { id: a2, name: "甲二", movedOut: false, left: true },
    ]));

    const { setEntryMembers } = await import("@/server/actions/entries");
    const res = await as("a1@g.nccu.edu.tw", () => setEntryMembers(entryId, [a1, a2]));
    expect(res).toEqual({ ok: false, error: "只能勾選自己組的專案生" });
  });

  it("confirm_entry／update_entry_members 拒絕已離開的成員", async () => {
    const a2 = await memberId("a2@g.nccu.edu.tw");
    await removeIdentity(a2);
    const db = service();
    const unconfirmed = await entry(false);
    const c = await db.rpc("confirm_entry", { p_entry_id: unconfirmed, p_member_ids: [a2] });
    expect(c.error?.message).toBe("只能勾選自己組的專案生");
    const u = await db.rpc("update_entry_members", { p_entry_id: unconfirmed, p_member_ids: [a2] });
    expect(u.error?.message).toBe("只能勾選自己組的專案生");
  });
});

describe("換組", () => {
  it("已離開的身份不能換組", async () => {
    const { moveMember } = await import("@/server/actions/admin");
    const id = await memberId("b1@g.nccu.edu.tw");
    await removeIdentity(id);
    await expect(as(ADMIN, () => moveMember(id, seed.groupA))).rejects.toThrow("這個身份已離開");
  });
});
