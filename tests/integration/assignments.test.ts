import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, service, clientAs, asUser, assignPm, asAdminNoMember, withRawPg } from "./helpers";

// 規格 §17：專案幹部出作業、組員繳交、權限與判燈。
// 情境：pm 負責第1組，出一份作業派給第2組（不是自己負責的）；pm2 負責第2組；pm3 沒負責任何組。
// 每條「不該看到／不該做到」的斷言都是防放寬：規則一鬆就會紅。

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockInspectUploaded = vi.fn();
const mockDeleteObject = vi.fn();
vi.mock("@/server/r2", () => ({
  inspectUploaded: (...args: unknown[]) => mockInspectUploaded(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  presignPdfGet: async (key: string) => `https://r2.test/${key}`,
}));

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  submitAssignment,
  editAssignmentNote,
  replaceAssignmentPdf,
  withdrawAssignment,
} from "@/server/actions/assignments";
import { getAssignmentPdfDownloadUrl } from "@/server/actions/download";
import { loadDashboard } from "@/server/queries/dashboard";

const LOCKED_ERROR = "已超過 2 小時，已鎖定不能修改";
let seed: Awaited<ReturnType<typeof seedSemester>>;
let pmId: string;
let pm2Id: string;

const DAY = 86_400_000;
const future = () => new Date(Date.now() + 7 * DAY);
function dateTime(d: Date) {
  const t = new Date(d.getTime() + 8 * 3_600_000).toISOString();
  return { deadlineDate: t.slice(0, 10), deadlineTime: t.slice(11, 16) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockInspectUploaded.mockResolvedValue({ isPdf: true, size: 100 });
  mockDeleteObject.mockResolvedValue(undefined);
  await resetDb();
  seed = await seedSemester({ acknowledged: true });
  const db = service();
  // seed 的第 1 期已經過了（2026-10-01），會讓第2組本來就亮燈；這裡把期別都移到未來，只看作業。
  await db.from("periods").update({ deadline: future().toISOString() }).eq("semester_id", seed.semesterId);
  const { error } = await db.from("members").insert([
    { semester_id: seed.semesterId, email: "pm2@g.nccu.edu.tw", name: "幹部二", role: "pm" },
    { semester_id: seed.semesterId, email: "pm3@g.nccu.edu.tw", name: "幹部三", role: "pm" },
  ]);
  if (error) throw error;
  await db.from("acknowledgements").insert(
    ["pm2", "pm3"].map((u) => ({ semester_id: seed.semesterId, email: `${u}@g.nccu.edu.tw` }))
  );
  await assignPm("pm@g.nccu.edu.tw", seed.groupA);
  await assignPm("pm2@g.nccu.edu.tw", seed.groupB);
  const { data: pms } = await db.from("members").select("id, email").eq("role", "pm");
  pmId = pms!.find((p) => p.email === "pm@g.nccu.edu.tw")!.id as string;
  pm2Id = pms!.find((p) => p.email === "pm2@g.nccu.edu.tw")!.id as string;
});

async function createAsPm(groupIds: string[], deadline = future(), title = "市場調查") {
  const r = await asUser("pm@g.nccu.edu.tw", () => createAssignment({ title, description: "寫 2 頁", groupIds, ...dateTime(deadline) }));
  if (!r.ok || !r.id) throw new Error(`create failed: ${JSON.stringify(r)}`);
  return r.id;
}

async function ticket(email: string, groupId: string, name = crypto.randomUUID()) {
  const key = `115-1/${groupId}/${name}.pdf`;
  const { error } = await service().from("upload_tickets").insert({ key, issuer_email: email });
  if (error) throw error;
  return key;
}

async function submitAsB1(assignmentId: string, note = "附上問卷") {
  const pdfKey = await ticket("b1@g.nccu.edu.tw", seed.groupB);
  const r = await asUser("b1@g.nccu.edu.tw", () => submitAssignment(assignmentId, { note, pdfKey }));
  expect(r).toEqual({ ok: true });
  const { data } = await service().from("assignment_submissions").select("id, pdf_key").eq("assignment_id", assignmentId).single();
  return { submissionId: data!.id as string, pdfKey: data!.pdf_key as string };
}

async function backdateSubmission(id: string, hoursAgo: number) {
  await withRawPg(async (c) => {
    await c.query("set session_replication_role = replica");
    await c.query("update assignment_submissions set pdf_uploaded_at = now() - make_interval(hours => $2) where id = $1", [id, hoursAgo]);
  });
}

describe("出作業（§17-1～3）", () => {
  it("專案幹部可以出作業，派給任何組（含非負責的組）", async () => {
    const id = await createAsPm([seed.groupB]);
    const { data } = await service().from("assignment_groups").select("group_id").eq("assignment_id", id);
    expect(data!.map((g) => g.group_id)).toEqual([seed.groupB]);
  });

  it("其他幹部、專案生不能出作業", async () => {
    const input = { title: "X", description: "", groupIds: [seed.groupA], ...dateTime(future()) };
    expect(await asUser("off@g.nccu.edu.tw", () => createAssignment(input))).toEqual({ ok: false, error: "只有專案幹部可以出作業" });
    expect(await asUser("a1@g.nccu.edu.tw", () => createAssignment(input))).toEqual({ ok: false, error: "只有專案幹部可以出作業" });
    asAdminNoMember(mockGetAccess, seed.semesterId);
    expect(await createAssignment(input)).toEqual({ ok: false, error: "只有專案幹部可以出作業" });
  });

  it("欄位驗證：沒有組、沒有標題、截止格式錯", async () => {
    const base = { title: "X", description: "", groupIds: [seed.groupA], ...dateTime(future()) };
    expect(await asUser("pm@g.nccu.edu.tw", () => createAssignment({ ...base, groupIds: [] }))).toEqual({ ok: false, error: "至少要派給一組" });
    expect(await asUser("pm@g.nccu.edu.tw", () => createAssignment({ ...base, title: " " }))).toEqual({ ok: false, error: "請填寫標題" });
    expect((await asUser("pm@g.nccu.edu.tw", () => createAssignment({ ...base, deadlineDate: "2026-02-30" }))).ok).toBe(false);
  });

  it("資料庫也擋：作者不是專案幹部、組不屬於本學期", async () => {
    const db = service();
    const { data: off } = await db.from("members").select("id").eq("email", "off@g.nccu.edu.tw").single();
    const bad = await db.rpc("create_assignment", {
      p_author: off!.id, p_title: "X", p_description: null, p_deadline: future().toISOString(), p_group_ids: [seed.groupA],
    });
    expect(bad.error?.message).toContain("只有專案幹部可以出作業");
    const badGroup = await db.rpc("create_assignment", {
      p_author: pmId, p_title: "X", p_description: null, p_deadline: future().toISOString(), p_group_ids: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(badGroup.error?.message).toContain("組別不屬於本學期");
  });
});

describe("修改、刪除只有出題者（§17-7、8）", () => {
  it("別的專案幹部改不了、刪不了（server action 與資料庫都擋）", async () => {
    const id = await createAsPm([seed.groupB]);
    const input = { title: "改", description: "", groupIds: [seed.groupB], ...dateTime(future()) };
    expect(await asUser("pm2@g.nccu.edu.tw", () => updateAssignment(id, input))).toEqual({ ok: false, error: "找不到這份作業" });
    expect(await asUser("pm2@g.nccu.edu.tw", () => deleteAssignment(id))).toEqual({ ok: false, error: "找不到這份作業" });
    expect((await service().rpc("delete_assignment", { p_assignment_id: id, p_author: pm2Id })).error?.message).toContain("找不到這份作業");
    asAdminNoMember(mockGetAccess, seed.semesterId);
    expect(await deleteAssignment(id)).toEqual({ ok: false, error: "找不到這份作業" });
    const { data } = await service().from("assignments").select("title").eq("id", id).single();
    expect(data!.title).toBe("市場調查");
  });

  it("出題者可以改標題、截止、派給的組", async () => {
    const id = await createAsPm([seed.groupB]);
    const r = await asUser("pm@g.nccu.edu.tw", () =>
      updateAssignment(id, { title: "改過", description: "", groupIds: [seed.groupA, seed.groupB], ...dateTime(future()) })
    );
    expect(r).toEqual({ ok: true });
    const { data } = await service().from("assignment_groups").select("group_id").eq("assignment_id", id);
    expect(new Set(data!.map((g) => g.group_id))).toEqual(new Set([seed.groupA, seed.groupB]));
  });

  it("取消派給已交的組：沒確認 → needsConfirm，什麼都不動；確認數對 → 一併刪掉繳交與檔案（含已鎖定的）", async () => {
    const id = await createAsPm([seed.groupA, seed.groupB]);
    const { submissionId, pdfKey } = await submitAsB1(id);
    await backdateSubmission(submissionId, 3);
    const input = { title: "市場調查", description: "", groupIds: [seed.groupA], ...dateTime(future()) };

    const first = await asUser("pm@g.nccu.edu.tw", () => updateAssignment(id, input));
    expect(first).toEqual({ ok: false, error: "有 1 組已經交了，刪除會一併刪掉這些繳交與檔案", needsConfirm: 1 });
    expect((await service().from("assignment_submissions").select("id").eq("id", submissionId)).data).toHaveLength(1);

    expect(await asUser("pm@g.nccu.edu.tw", () => updateAssignment(id, input, 1))).toEqual({ ok: true });
    expect((await service().from("assignment_submissions").select("id").eq("id", submissionId)).data).toEqual([]);
    expect(mockDeleteObject).toHaveBeenCalledWith(pdfKey);
  });

  it("刪除已有人交的作業：要帶正確確認數", async () => {
    const id = await createAsPm([seed.groupB]);
    await submitAsB1(id);
    expect((await asUser("pm@g.nccu.edu.tw", () => deleteAssignment(id))).ok).toBe(false);
    expect((await asUser("pm@g.nccu.edu.tw", () => deleteAssignment(id, 2))).ok).toBe(false);
    expect(await asUser("pm@g.nccu.edu.tw", () => deleteAssignment(id, 1))).toEqual({ ok: true });
    expect((await service().from("assignments").select("id").eq("id", id)).data).toEqual([]);
  });

  it("出題者已離開：沒有人能改（§17-9），作業照常保留", async () => {
    const id = await createAsPm([seed.groupB]);
    await service().from("members").update({ left_at: new Date().toISOString() }).eq("id", pmId);
    const r = await service().rpc("delete_assignment", { p_assignment_id: id, p_author: pmId });
    expect(r.error?.message).toContain("只有專案幹部可以出作業");
    expect((await service().from("assignments").select("id").eq("id", id)).data).toHaveLength(1);
  });
});

describe("誰看得到（§17-10、11）", () => {
  let id: string;
  beforeEach(async () => {
    id = await createAsPm([seed.groupB]);
    await submitAsB1(id, "這是說明");
  });

  async function read(email: string) {
    const db = await clientAs(email);
    const [a, s, st] = await Promise.all([
      db.from("assignments").select("id").eq("id", id),
      db.from("assignment_submissions").select("note, pdf_key").eq("assignment_id", id),
      db.from("assignment_status").select("group_id, pdf_uploaded_at").eq("assignment_id", id),
    ]);
    return { assignment: a.data!.length, content: s.data!.length, status: st.data!.length };
  }

  it("被派到的組員：作業、內容、狀態都看得到", async () => {
    expect(await read("b1@g.nccu.edu.tw")).toEqual({ assignment: 1, content: 1, status: 1 });
  });

  it("出題者（不是該組負責幹部）看得到內容", async () => {
    expect(await read("pm@g.nccu.edu.tw")).toEqual({ assignment: 1, content: 1, status: 1 });
  });

  it("該組負責專案幹部看得到內容", async () => {
    expect(await read("pm2@g.nccu.edu.tw")).toEqual({ assignment: 1, content: 1, status: 1 });
  });

  it("其他專案幹部、其他幹部：只看得到作業與狀態，讀不到內容", async () => {
    expect(await read("pm3@g.nccu.edu.tw")).toEqual({ assignment: 1, content: 0, status: 1 });
    expect(await read("off@g.nccu.edu.tw")).toEqual({ assignment: 1, content: 0, status: 1 });
  });

  it("沒被派到的組員：連作業都看不到", async () => {
    expect(await read("a1@g.nccu.edu.tw")).toEqual({ assignment: 0, content: 0, status: 0 });
  });

  it("下載：出題者、負責幹部、組員可以；其他專案幹部、別組學生不行", async () => {
    const { data } = await service().from("assignment_submissions").select("id").eq("assignment_id", id).single();
    const sid = data!.id as string;
    for (const [email, ok] of [["pm@g.nccu.edu.tw", true], ["pm2@g.nccu.edu.tw", true], ["b1@g.nccu.edu.tw", true], ["pm3@g.nccu.edu.tw", false], ["a1@g.nccu.edu.tw", false]] as const) {
      mockCreateServerSupabase.mockResolvedValue(await clientAs(email));
      const r = await asUser(email, () => getAssignmentPdfDownloadUrl(sid));
      expect(r.ok, email).toBe(ok);
    }
  });

  it("一般使用者不能直接寫這幾張表", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    expect((await db.from("assignment_submissions").update({ note: "改" }).eq("assignment_id", id).select()).error).not.toBeNull();
    expect((await db.from("assignments").insert({ semester_id: seed.semesterId, title: "X", deadline: future().toISOString(), created_by: pmId })).error).not.toBeNull();
  });
});

describe("繳交（§17-4、5）", () => {
  it("沒被派到的組交不了", async () => {
    const id = await createAsPm([seed.groupB]);
    const pdfKey = await ticket("a1@g.nccu.edu.tw", seed.groupA);
    expect(await asUser("a1@g.nccu.edu.tw", () => submitAssignment(id, { note: "", pdfKey }))).toEqual({ ok: false, error: "找不到這份作業" });
  });

  it("幹部交不了；用別人的上傳票交不了", async () => {
    const id = await createAsPm([seed.groupB]);
    const pdfKey = await ticket("pm2@g.nccu.edu.tw", seed.groupB);
    expect((await asUser("pm2@g.nccu.edu.tw", () => submitAssignment(id, { note: "", pdfKey }))).ok).toBe(false);
    const { error } = await service().from("members").insert({ semester_id: seed.semesterId, email: "b2@g.nccu.edu.tw", name: "乙二", role: "student", group_id: seed.groupB });
    if (error) throw error;
    await service().from("acknowledgements").insert({ semester_id: seed.semesterId, email: "b2@g.nccu.edu.tw" });
    const othersKey = await ticket("b1@g.nccu.edu.tw", seed.groupB);
    expect(await asUser("b2@g.nccu.edu.tw", () => submitAssignment(id, { note: "", pdfKey: othersKey }))).toEqual({
      ok: false,
      error: "檔案沒有上傳成功，請重新選擇 PDF",
    });
  });

  it("2 小時內可以改說明、換 PDF（更新繳交時間）、撤回", async () => {
    const id = await createAsPm([seed.groupB]);
    const { submissionId, pdfKey } = await submitAsB1(id);
    expect(await asUser("b1@g.nccu.edu.tw", () => editAssignmentNote(submissionId, "新說明"))).toEqual({ ok: true });

    const { data: before } = await service().from("assignment_submissions").select("pdf_uploaded_at").eq("id", submissionId).single();
    const newKey = await ticket("b1@g.nccu.edu.tw", seed.groupB);
    const replaced = await asUser("b1@g.nccu.edu.tw", () => replaceAssignmentPdf(submissionId, newKey));
    expect(replaced).toEqual({ ok: true, becameLate: false });
    const { data: after } = await service().from("assignment_submissions").select("note, pdf_key, pdf_uploaded_at").eq("id", submissionId).single();
    expect(after!.note).toBe("新說明");
    expect(after!.pdf_key).toBe(newKey);
    expect(new Date(after!.pdf_uploaded_at).getTime()).toBeGreaterThanOrEqual(new Date(before!.pdf_uploaded_at).getTime());
    expect(mockDeleteObject).toHaveBeenCalledWith(pdfKey);

    expect(await asUser("b1@g.nccu.edu.tw", () => withdrawAssignment(submissionId))).toEqual({ ok: true });
    expect((await service().from("assignment_submissions").select("id").eq("id", submissionId)).data).toEqual([]);
  });

  it("滿 2 小時鎖定：改說明、換檔、撤回都被擋，資料庫本身也擋", async () => {
    const id = await createAsPm([seed.groupB]);
    const { submissionId } = await submitAsB1(id);
    await backdateSubmission(submissionId, 3);
    expect(await asUser("b1@g.nccu.edu.tw", () => editAssignmentNote(submissionId, "x"))).toEqual({ ok: false, error: LOCKED_ERROR });
    const key = await ticket("b1@g.nccu.edu.tw", seed.groupB);
    expect(await asUser("b1@g.nccu.edu.tw", () => replaceAssignmentPdf(submissionId, key))).toEqual({ ok: false, error: LOCKED_ERROR });
    expect(await asUser("b1@g.nccu.edu.tw", () => withdrawAssignment(submissionId))).toEqual({ ok: false, error: LOCKED_ERROR });
    const direct = await service().from("assignment_submissions").delete().eq("id", submissionId);
    expect(direct.error?.message).toContain("LOCKED");
  });

  it("別組學生動不了這份繳交", async () => {
    const id = await createAsPm([seed.groupB]);
    const { submissionId } = await submitAsB1(id);
    expect(await asUser("a1@g.nccu.edu.tw", () => withdrawAssignment(submissionId))).toEqual({ ok: false, error: "找不到這份繳交" });
  });
});

describe("判燈（§17-6）", () => {
  it("作業逾期 2 天沒交 → 第2組專案線黃燈，來源寫作業名稱；交了（逾期）→ 綠燈、準時率 0%", async () => {
    const id = await createAsPm([seed.groupB], new Date(Date.now() + DAY), "競品分析");
    await service().from("assignments").update({ deadline: new Date(Date.now() - 2 * DAY - 3_600_000).toISOString() }).eq("id", id);

    asAdminNoMember(mockGetAccess, seed.semesterId);
    let card = (await loadDashboard()).cards.find((c) => c.groupId === seed.groupB)!;
    expect(card.lines[0].light).toBe("yellow");
    expect(card.lines[0].source).toBe("系統：作業「競品分析」逾期 2 天");
    const other = (await loadDashboard()).cards.find((c) => c.groupId === seed.groupA)!;
    expect(other.lines[0].source).not.toContain("競品分析");

    await submitAsB1(id);
    asAdminNoMember(mockGetAccess, seed.semesterId);
    card = (await loadDashboard()).cards.find((c) => c.groupId === seed.groupB)!;
    expect(card.lines[0].light).toBe("green");
    expect(card.lines[0].onTime).toBe(0);
  });

  it("逾期滿 72 小時 → 紅燈", async () => {
    const id = await createAsPm([seed.groupB]);
    await service().from("assignments").update({ deadline: new Date(Date.now() - 4 * DAY).toISOString() }).eq("id", id);
    asAdminNoMember(mockGetAccess, seed.semesterId);
    const card = (await loadDashboard()).cards.find((c) => c.groupId === seed.groupB)!;
    expect(card.lines[0].light).toBe("red");
  });
});
