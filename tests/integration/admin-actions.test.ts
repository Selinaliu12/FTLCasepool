import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, okAccess } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// admin actions 一律先呼叫 requireAdmin()（建在 getAccess() 上）。這裡整份測試都用
// vi.mock 假造 @/server/session，讓每個測試自己決定「呼叫者是誰」，不用真的登入。
const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function asStudent(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m1", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId: "g1" },
    semesterId,
  }));
}

// kind:"ok" 一定帶著真的 semesterId（Access 的型別本來就是這樣定義的：{kind:"ok", semesterId:
// string, ...}）。「管理員、但還沒有任何學期」是另一個獨立的 kind:"no_semester"，不是
// kind:"ok" 加一個 null 的 semesterId——那是型別上不可能出現的狀態，fix round 1 之前的版本
// 誤用了它（asAdmin(null)）。
function asAdmin(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  }));
}

function asAdminNoSemester() {
  mockGetAccess.mockResolvedValue({ kind: "no_semester", isAdmin: true });
}

function asNoSemesterNonAdmin() {
  mockGetAccess.mockResolvedValue({ kind: "no_semester", isAdmin: false });
}

function asWrongDomain() {
  mockGetAccess.mockResolvedValue({ kind: "wrong_domain" });
}

function asNotInRoster() {
  mockGetAccess.mockResolvedValue({ kind: "not_in_roster" });
}

describe("requireAdmin", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("非管理員呼叫任何動作都被拒", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("115-2")).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("其他五個動作對非管理員一樣被拒", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { importRoster, savePeriods, setPmGroups, setRedAfterHours, moveMember } = await import("@/server/actions/admin");
    await expect(importRoster(seed.semesterId, "")).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(savePeriods(seed.semesterId, [])).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(setPmGroups("m1", [])).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(setRedAfterHours(seed.semesterId, 48)).rejects.toThrow("只有系統管理員可以這樣做");
    await expect(moveMember("m1", "g1")).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("還沒有學期、也不是管理員 → 被拒", async () => {
    await resetDb(); // 真的沒有任何學期
    asNoSemesterNonAdmin();
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("115-1")).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("wrong_domain → 被拒", async () => {
    const seed = await seedSemester();
    asWrongDomain();
    const { setRedAfterHours } = await import("@/server/actions/admin");
    await expect(setRedAfterHours(seed.semesterId, 48)).rejects.toThrow("只有系統管理員可以這樣做");
  });

  it("not_in_roster → 被拒", async () => {
    const seed = await seedSemester();
    asNotInRoster();
    const { setRedAfterHours } = await import("@/server/actions/admin");
    await expect(setRedAfterHours(seed.semesterId, 48)).rejects.toThrow("只有系統管理員可以這樣做");
  });
});

describe("createSemester", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("還沒有任何學期時可以建立第一個學期", async () => {
    asAdminNoSemester();
    const { createSemester } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");

    const svc = createServiceSupabase();
    const { data } = await svc.from("semesters").select("id, name, is_current");
    expect(data).toEqual([{ id: semesterId, name: "115-1", is_current: true }]);
  });

  it("已經有當前學期時，建新學期只讓新的是當前學期", async () => {
    const seed = await seedSemester(); // 種好 "115-1"，is_current=true
    asAdmin(seed.semesterId);
    const { createSemester } = await import("@/server/actions/admin");
    const { semesterId: newId } = await createSemester("115-2");

    const svc = createServiceSupabase();
    const { data } = await svc.from("semesters").select("id, is_current").order("name");
    expect(data).toEqual([
      { id: seed.semesterId, is_current: false },
      { id: newId, is_current: true },
    ]);
  });

  it("學期名稱重複：回傳錯誤，而且舊學期仍然是當前學期", async () => {
    const seed = await seedSemester(); // "115-1"
    asAdmin(seed.semesterId);
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("115-1")).rejects.toThrow("這個學期名稱已經存在");

    const svc = createServiceSupabase();
    const { data } = await svc.from("semesters").select("id, is_current");
    expect(data).toEqual([{ id: seed.semesterId, is_current: true }]);
  });

  it("空白學期名稱回傳錯誤", async () => {
    asAdminNoSemester();
    const { createSemester } = await import("@/server/actions/admin");
    await expect(createSemester("   ")).rejects.toThrow("請輸入學期名稱");
  });
});

const CSV_OK = [
  "email,姓名,角色,學號,系級,組別,專案名稱",
  "s1@g.nccu.edu.tw,甲一,專案生,110701001,資科三,第1組,專案A",
  "s2@g.nccu.edu.tw,甲二,專案生,110701002,資科三,第1組,專案A",
  "s3@g.nccu.edu.tw,乙一,專案生,110701003,資科三,第2組,專案B",
  "pm1@g.nccu.edu.tw,幹部,專案幹部,,,,",
].join("\n");

describe("importRoster", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("匯入後：2 組、每組 1 條專案線、成員歸組", async () => {
    asAdminNoSemester();
    const { createSemester } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const { importRoster } = await import("@/server/actions/admin");
    const r = await importRoster(semesterId, CSV_OK);
    expect(r).toEqual({ ok: true, imported: 4 });

    const svc = createServiceSupabase();
    const { data: groups } = await svc
      .from("groups")
      .select("name, lines(kind)")
      .eq("semester_id", semesterId)
      .order("name");
    expect(groups).toEqual([
      { name: "第1組", lines: [{ kind: "project" }] },
      { name: "第2組", lines: [{ kind: "project" }] },
    ]);
  });

  it("成員真的歸到正確的組（email → 組名）", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    await importRoster(semesterId, CSV_OK);

    const svc = createServiceSupabase();
    const { data: members } = await svc
      .from("members")
      .select("email, role, groups!members_group_id_fkey(name)")
      .eq("semester_id", semesterId)
      .order("email");
    expect(members).toEqual([
      { email: "pm1@g.nccu.edu.tw", role: "pm", groups: null },
      { email: "s1@g.nccu.edu.tw", role: "student", groups: { name: "第1組" } },
      { email: "s2@g.nccu.edu.tw", role: "student", groups: { name: "第1組" } },
      { email: "s3@g.nccu.edu.tw", role: "student", groups: { name: "第2組" } },
    ]);
  });

  it("CSV 有錯就一筆都不寫入", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const badCsv = [
      "email,姓名,角色,學號,系級,組別,專案名稱",
      "s1@g.nccu.edu.tw,甲一,學生,110701001,資科三,第1組,專案A",
    ].join("\n");
    const r = await importRoster(semesterId, badCsv);
    expect(r).toEqual({ ok: false, errors: ["第 2 列：角色「學生」不是 專案幹部／其他幹部／專案生"] });

    const svc = createServiceSupabase();
    const { count } = await svc.from("members").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
    expect(count).toBe(0);
  });

  it("已經匯入過的學期不能再整批匯入", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    await importRoster(semesterId, CSV_OK);
    const r = await importRoster(semesterId, CSV_OK);
    expect(r).toEqual({ ok: false, errors: ["本學期已匯入名單；學期中的異動請用「換組」"] });
  });

  // §14：同一個人可以同時是兩組的專案生，也可以身兼專案幹部——三列身份都要各自寫進 members。
  it("多列匯入：同一人在兩組是專案生，同時也是專案幹部", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const csv = [
      "email,姓名,角色,學號,系級,組別,專案名稱",
      "multi@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,專案A",
      "multi@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第2組,專案B",
      "multi@g.nccu.edu.tw,王小明,專案幹部,110701001,資科三,,",
      "s2@g.nccu.edu.tw,甲二,專案生,110701002,資科三,第1組,專案A",
    ].join("\n");
    const r = await importRoster(semesterId, csv);
    expect(r).toEqual({ ok: true, imported: 4 });

    const svc = createServiceSupabase();
    const { data: rows } = await svc
      .from("members")
      .select("role, student_id, dept_year, groups!members_group_id_fkey(name)")
      .eq("semester_id", semesterId)
      .eq("email", "multi@g.nccu.edu.tw");
    type Row = { role: string; student_id: string | null; dept_year: string | null; groups: { name: string } | null };
    const sorted = ((rows ?? []) as unknown as Row[]).sort((a, b) => (a.groups?.name ?? "").localeCompare(b.groups?.name ?? ""));
    expect(sorted).toEqual([
      { role: "pm", student_id: "110701001", dept_year: "資科三", groups: null },
      { role: "student", student_id: "110701001", dept_year: "資科三", groups: { name: "第1組" } },
      { role: "student", student_id: "110701001", dept_year: "資科三", groups: { name: "第2組" } },
    ]);
  });

  it("資料不一致（同信箱姓名不同）被拒，一筆都不寫入", async () => {
    asAdminNoSemester();
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const csv = [
      "email,姓名,角色,學號,系級,組別,專案名稱",
      "multi@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,專案A",
      "multi@g.nccu.edu.tw,王小明二,專案生,110701001,資科三,第2組,專案B",
    ].join("\n");
    const r = await importRoster(semesterId, csv);
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：同一個信箱的姓名／學號／系級要一致（和第 2 列不同）"],
    });

    const svc = createServiceSupabase();
    const { count } = await svc.from("members").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
    expect(count).toBe(0);
  });
});

describe("savePeriods", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("依日期排序編成第 1、2、3 期，截止時間照台北時間存", async () => {
    asAdminNoSemester();
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const r = await savePeriods(semesterId, [
      { date: "2026-11-01", time: "23:59" },
      { date: "2026-10-01", time: "23:59" },
      { date: "2026-12-01", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: true });

    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("seq, deadline").eq("semester_id", semesterId).order("seq");
    expect((data ?? []).map((p) => ({ seq: p.seq, deadline: new Date(p.deadline).toISOString() }))).toEqual([
      { seq: 1, deadline: new Date("2026-10-01T15:59:59.999Z").toISOString() },
      { seq: 2, deadline: new Date("2026-11-01T15:59:59.999Z").toISOString() },
      { seq: 3, deadline: new Date("2026-12-01T15:59:59.999Z").toISOString() },
    ]);
  });

  it("日期重複、格式錯回傳錯誤，不寫入", async () => {
    asAdminNoSemester();
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const r = await savePeriods(semesterId, [
      { date: "2026-10-01", time: "23:59" },
      { date: "2026-10-01", time: "23:59" },
      { date: "not-a-date", time: "23:59" },
    ]);
    expect(r).toEqual({
      ok: false,
      errors: ["第 3 列：日期或時間格式錯誤", "第 2 列：和第 1 列的截止時間重複"],
    });

    const svc = createServiceSupabase();
    const { count } = await svc.from("periods").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
    expect(count).toBe(0);
  });

  // 最終審查 #2：期別表不再「第一份進度交出去就整張凍結」。已經有人交件的期別（seedSemester
  // 在第 1 期插了一筆 progress_reports）不能改、不能刪；沒人交過的期別可以改、可以刪；可以往後
  // 追加新的期別；但所有沒凍結的截止時間都必須晚於最後一個凍結期別，讓凍結期別的編號永遠不會位移。
  // seed：第 1 期 2026-10-01T00:00Z（台北 10/01 08:00，已有人交件）、第 2 期 2026-11-01T00:00Z（台北 08:00）。
  async function periodsOf(semesterId: string) {
    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("id, seq, deadline").eq("semester_id", semesterId).order("seq");
    return (data ?? []).map((p) => ({ id: p.id as string, seq: p.seq as number, deadline: new Date(p.deadline).toISOString() }));
  }

  it("沒人交件的期別可以修改；凍結的期別原封不動", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00" },
      { id: seed.periodIds[1], date: "2026-11-15", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: true });
    expect(await periodsOf(seed.semesterId)).toEqual([
      { id: seed.periodIds[0], seq: 1, deadline: "2026-10-01T00:00:00.000Z" },
      { id: seed.periodIds[1], seq: 2, deadline: "2026-11-15T15:59:59.999Z" },
    ]);
  });

  it("每一列的建議內容會存起來；空白字串存成 null", async () => {
    asAdminNoSemester();
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    asAdmin(semesterId);
    const r = await savePeriods(semesterId, [
      { date: "2026-10-01", time: "23:59", suggestion: "這期建議交截圖" },
      { date: "2026-11-01", time: "23:59", suggestion: "   " },
    ]);
    expect(r).toEqual({ ok: true });

    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("seq, suggestion").eq("semester_id", semesterId).order("seq");
    expect(data).toEqual([
      { seq: 1, suggestion: "這期建議交截圖" },
      { seq: 2, suggestion: null },
    ]);
  });

  it("已有人交件的期別，建議內容仍可修改；日期不動", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00", suggestion: "凍結期也能改建議" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
    ]);
    expect(r).toEqual({ ok: true });

    const rows = await periodsOf(seed.semesterId);
    expect(rows[0].deadline).toBe("2026-10-01T00:00:00.000Z");
    const svc = createServiceSupabase();
    const { data } = await svc.from("periods").select("id, suggestion").eq("semester_id", seed.semesterId).order("seq");
    expect(data).toEqual([
      { id: seed.periodIds[0], suggestion: "凍結期也能改建議" },
      { id: seed.periodIds[1], suggestion: null },
    ]);
  });

  it("修改已有人交件的期別被拒，錯誤訊息指出第幾期", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-03", time: "23:59" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
    ]);
    expect(r).toEqual({ ok: false, errors: ["第 1 期已經有組別交了進度，不能修改或刪除"] });
    expect((await periodsOf(seed.semesterId))[0].deadline).toBe("2026-10-01T00:00:00.000Z");
  });

  it("刪除已有人交件的期別被拒", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }]);
    expect(r).toEqual({ ok: false, errors: ["第 1 期已經有組別交了進度，不能修改或刪除"] });
    expect(await periodsOf(seed.semesterId)).toHaveLength(2);
  });

  it("沒人交件的期別可以刪除", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[0], date: "2026-10-01", time: "08:00" }]);
    expect(r).toEqual({ ok: true });
    expect((await periodsOf(seed.semesterId)).map((p) => p.id)).toEqual([seed.periodIds[0]]);
  });

  it("可以往後追加新的期別，編號接在後面", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
      { date: "2026-12-01", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: true });
    const rows = await periodsOf(seed.semesterId);
    expect(rows.map((p) => [p.seq, p.deadline])).toEqual([
      [1, "2026-10-01T00:00:00.000Z"],
      [2, "2026-11-01T00:00:00.000Z"],
      [3, "2026-12-01T15:59:59.999Z"],
    ]);
  });

  it("新的截止時間早於最後一個凍結期別被拒", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
      { date: "2026-09-20", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: false, errors: ["新的截止時間必須晚於已有人交件的第 1 期"] });
    expect(await periodsOf(seed.semesterId)).toHaveLength(2);
  });

  it("沒凍結的期別改到比凍結期別還早，一樣被拒", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-10-01", time: "08:00" },
      { id: seed.periodIds[1], date: "2026-09-20", time: "23:59" },
    ]);
    expect(r).toEqual({ ok: false, errors: ["新的截止時間必須晚於已有人交件的第 1 期"] });
  });

  it("資料庫層：直接刪除有進度的期別會被外鍵擋下（on delete restrict）", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();
    const { error } = await svc.from("periods").delete().eq("id", seed.periodIds[0]);
    expect(error?.code).toBe("23503");
    expect(await periodsOf(seed.semesterId)).toHaveLength(2);
    const { count } = await svc.from("progress_reports").select("id", { count: "exact", head: true }).eq("period_id", seed.periodIds[0]);
    expect(count).toBe(1);
  });

  it("save_periods 只開給 service_role", async () => {
    const { withRawPg } = await import("./helpers");
    await withRawPg(async (client) => {
      for (const role of ["anon", "authenticated"]) {
        const res = await client.query("select has_function_privilege($1, 'save_periods(uuid, jsonb)', 'execute') as ok", [role]);
        expect(res.rows[0].ok, role).toBe(false);
      }
      const svc = await client.query("select has_function_privilege('service_role', 'save_periods(uuid, jsonb)', 'execute') as ok");
      expect(svc.rows[0].ok).toBe(true);
    });
  });
});

describe("setPmGroups", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("取代該專案幹部原本的負責組別", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: pm } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "pm").single();
    const { setPmGroups } = await import("@/server/actions/admin");

    await setPmGroups(pm!.id, [seed.groupA]);
    let { data: assigns } = await svc.from("pm_assignments").select("group_id").eq("pm_member_id", pm!.id);
    expect(assigns).toEqual([{ group_id: seed.groupA }]);

    await setPmGroups(pm!.id, [seed.groupB]);
    ({ data: assigns } = await svc.from("pm_assignments").select("group_id").eq("pm_member_id", pm!.id));
    expect(assigns).toEqual([{ group_id: seed.groupB }]);
  });

  it("對「其他幹部」呼叫要丟錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: officer } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "officer").single();
    const { setPmGroups } = await import("@/server/actions/admin");
    await expect(setPmGroups(officer!.id, [seed.groupA])).rejects.toThrow("只有專案幹部才能負責組別");
  });

  it("組別不屬於這位幹部的學期時丟錯，而且原本的指派不受影響", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: pm } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "pm").single();
    const { setPmGroups } = await import("@/server/actions/admin");

    // 先指派一個合法的組別，作為「原本的指派」的基準。
    await setPmGroups(pm!.id, [seed.groupA]);

    const { data: otherSem } = await svc.from("semesters").insert({ name: "115-2" }).select("id").single();
    const { data: otherGroup } = await svc
      .from("groups")
      .insert({ semester_id: otherSem!.id, name: "第1組", project_name: "X" })
      .select("id")
      .single();

    await expect(setPmGroups(pm!.id, [seed.groupB, otherGroup!.id])).rejects.toThrow("組別不屬於本學期");

    const { data: assigns } = await svc.from("pm_assignments").select("group_id").eq("pm_member_id", pm!.id);
    expect(assigns).toEqual([{ group_id: seed.groupA }]);
  });
});

describe("setRedAfterHours", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("接受邊界值 1 和 720", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { setRedAfterHours } = await import("@/server/actions/admin");
    const svc = createServiceSupabase();

    await setRedAfterHours(seed.semesterId, 1);
    let { data } = await svc.from("semesters").select("red_after_hours").eq("id", seed.semesterId).single();
    expect(data?.red_after_hours).toBe(1);

    await setRedAfterHours(seed.semesterId, 720);
    ({ data } = await svc.from("semesters").select("red_after_hours").eq("id", seed.semesterId).single());
    expect(data?.red_after_hours).toBe(720);
  });

  it("拒絕邊界外的 0、721，以及非整數", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { setRedAfterHours } = await import("@/server/actions/admin");
    await expect(setRedAfterHours(seed.semesterId, 0)).rejects.toThrow("紅燈門檻必須是 1 到 720 之間的整數小時");
    await expect(setRedAfterHours(seed.semesterId, 721)).rejects.toThrow("紅燈門檻必須是 1 到 720 之間的整數小時");
    await expect(setRedAfterHours(seed.semesterId, 1.5)).rejects.toThrow("紅燈門檻必須是 1 到 720 之間的整數小時");
  });
});

describe("moveMember", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("換組後，舊組的進度紀錄仍在舊組", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw").single();
    const { moveMember } = await import("@/server/actions/admin");

    await moveMember(a1!.id, seed.groupB);

    const { data: member } = await svc.from("members").select("group_id").eq("id", a1!.id).single();
    expect(member?.group_id).toBe(seed.groupB);

    const { data: report } = await svc
      .from("progress_reports")
      .select("submitted_by")
      .eq("line_id", seed.lineA)
      .eq("period_id", seed.periodIds[0])
      .single();
    expect(report?.submitted_by).toBe("a1@g.nccu.edu.tw");
  });

  it("移動非專案生會丟錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: pm } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("role", "pm").single();
    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(pm!.id, seed.groupB)).rejects.toThrow("只有專案生可以換組");
  });

  it("目標組別不在同一個學期會丟錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: otherSem } = await svc.from("semesters").insert({ name: "115-2" }).select("id").single();
    const { data: otherGroup } = await svc.from("groups").insert({ semester_id: otherSem!.id, name: "第1組", project_name: "X" }).select("id").single();
    const { data: a1 } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw").single();
    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(a1!.id, otherGroup!.id)).rejects.toThrow("目標組別必須在同一個學期");
  });

  // F2：pre-check 跟真正的 update 之間有一個小競速窗口（例如兩個管理員幾乎同時把同一個人
  // 搬進同一組）。這裡先真的在 DB 插入一列衝突資料，再讓 moveMember 內部那次 pre-check
  // 查詢騙自己「沒看到衝突」（模擬 pre-check 查完之後、衝突列才出現的時間點），逼它繼續跑到
  // 真正的 update；update 因為 DB 已經有衝突列，會撞到真正的 members_identity_key 23505。
  // 確認 moveMember 把這個 23505 轉成跟 pre-check 分支一樣好懂的訊息，而不是把 raw error
  // 丟給呼叫端。
  it("update 階段才撞到 23505（競速）時，也回這位同學已經在第N組了，不是 raw error", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const realSvc = createServiceSupabase();
    const { data: a1 } = await realSvc
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();

    // 真的讓目標組已經有衝突列（a1 已經是第2組的專案生）。
    const { error: insertError } = await realSvc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: seed.groupB });
    expect(insertError).toBeNull();

    vi.resetModules();
    vi.doMock("@/server/supabase", () => ({
      createServiceSupabase: () => {
        let precheckAnswered = false;
        return new Proxy(realSvc, {
          get(target, prop, receiver) {
            if (prop !== "from") return Reflect.get(target, prop, receiver);
            return (table: string) => {
              const builder = (target.from as (t: string) => ReturnType<typeof realSvc.from>)(table);
              if (table !== "members" || precheckAnswered) return builder;
              const originalSelect = (builder as unknown as { select: (...a: unknown[]) => unknown }).select.bind(builder);
              return Object.assign(builder, {
                select: (...args: unknown[]) => {
                  const chain = originalSelect(...args) as { maybeSingle: () => Promise<unknown> };
                  return Object.assign(chain, {
                    // pre-check 用 maybeSingle()；騙它這次沒查到任何衝突列，模擬 pre-check
                    // 執行的當下（在真正插入衝突列之前）確實看不到衝突的競速情境。
                    maybeSingle: async () => {
                      precheckAnswered = true;
                      return { data: null, error: null };
                    },
                  });
                },
              });
            };
          },
        });
      },
    }));

    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(a1!.id, seed.groupB)).rejects.toThrow("這位同學已經在第2組了");

    vi.doUnmock("@/server/supabase");
    vi.resetModules();
  });

  // §14：moveMember 只搬動那一列。如果這個人在目標組已經有另一列專案生身份，
  // 搬過去會撞 members_identity_key，要回一句看得懂的錯誤，而不是資料庫的 23505。
  it("同一人在目標組已有專案生身份 → 這位同學已經在第N組了", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc.from("members").select("id").eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw").single();
    // 讓 a1 同時也是第2組的專案生（多列身份）。
    const { error: insertError } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", group_id: seed.groupB });
    expect(insertError).toBeNull();

    const { moveMember } = await import("@/server/actions/admin");
    await expect(moveMember(a1!.id, seed.groupB)).rejects.toThrow("這位同學已經在第2組了");
  });

  // F5(b)：moveMember 只搬動被指定的那一列，這個人在其他組的另一列身份要維持原樣
  // （group_id、student_id、dept_year 都不能被動到）。
  it("換組後，這個人在其他組的另一列身份不受影響", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();
    // 讓 a1 同時也是第2組的專案生（多列身份），這一列跟被搬動的那一列不同 id。
    const { data: otherRow, error: insertError } = await svc
      .from("members")
      .insert({
        semester_id: seed.semesterId,
        email: "a1@g.nccu.edu.tw",
        name: "甲一",
        role: "student",
        student_id: "110701001",
        dept_year: "資科三",
        group_id: seed.groupB,
      })
      .select("id, group_id, student_id, dept_year")
      .single();
    expect(insertError).toBeNull();

    // 建第三組，把 a1 原本第1組那一列搬過去；第2組那一列（otherRow）不該被動到。
    const { data: groupC } = await svc.from("groups").insert({ semester_id: seed.semesterId, name: "第3組", project_name: "專案C" }).select("id").single();

    const { moveMember } = await import("@/server/actions/admin");
    await moveMember(a1!.id, groupC!.id);

    const { data: movedRow } = await svc.from("members").select("id, group_id").eq("id", a1!.id).single();
    expect(movedRow?.group_id).toBe(groupC!.id);

    const { data: untouchedRow } = await svc
      .from("members")
      .select("id, group_id, student_id, dept_year")
      .eq("id", otherRow!.id)
      .single();
    expect(untouchedRow).toEqual(otherRow);
  });

  // F3：舊資料相容——沒有學號、系級的既有成員（seedSemester() 種子資料本來就是這樣）換組
  // 仍要成功，管理員頁名單查詢（select ... student_id ...）也不會被 null 值弄壞。
  it("成員沒有學號、系級（舊資料）時，換組仍成功，名單查詢也不出錯", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const svc = createServiceSupabase();
    const { data: a1 } = await svc
      .from("members")
      .select("id, student_id, dept_year")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();
    expect(a1?.student_id).toBeNull();
    expect(a1?.dept_year).toBeNull();

    const { moveMember } = await import("@/server/actions/admin");
    await moveMember(a1!.id, seed.groupB);

    const { data: moved } = await svc.from("members").select("group_id, student_id, dept_year").eq("id", a1!.id).single();
    expect(moved).toEqual({ group_id: seed.groupB, student_id: null, dept_year: null });

    // 管理員頁換組選單用的查詢（src/app/(app)/admin/page.tsx）：對 null 學號的列也要正常回傳。
    const { data: roster, error: rosterError } = await svc
      .from("members")
      .select("id, name, email, role, student_id, group_id")
      .eq("semester_id", seed.semesterId)
      .order("name");
    expect(rosterError).toBeNull();
    expect(roster?.some((m) => m.id === a1!.id && m.student_id === null)).toBe(true);
  });
});

// F5(a)：members_identity_key 唯一索引要真的擋住 DB 層面的重複身份，不只是靠應用層的
// pre-check。幹部（role=officer）沒有組別，group_id 是 null；index 用 coalesce 把 null
// 也當成可比較的值，同一學期、同一信箱、同一角色、group 都是 null 的第二列必須被拒絕。
describe("members_identity_key 唯一索引", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("同一學期、同信箱、同角色（其他幹部）、組別都是 null，插入第二列會被唯一索引擋下來", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();

    const { error: firstError } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "dup-officer@g.nccu.edu.tw", name: "重複幹部", role: "officer", group_id: null });
    expect(firstError).toBeNull();

    const { error: secondError } = await svc
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "dup-officer@g.nccu.edu.tw", name: "重複幹部", role: "officer", group_id: null });
    expect(secondError?.code).toBe("23505");
  });
});
