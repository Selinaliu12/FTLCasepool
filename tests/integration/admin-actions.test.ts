import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// admin actions 一律先呼叫 requireAdmin()（建在 getAccess() 上）。這裡整份測試都用
// vi.mock 假造 @/server/session，讓每個測試自己決定「呼叫者是誰」，不用真的登入。
const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function asStudent(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m1", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId: "g1" },
    semesterId,
  });
}

function asAdmin(semesterId: string | null) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  });
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
});

const CSV_OK = [
  "email,姓名,角色,組別,專案名稱",
  "s1@g.nccu.edu.tw,甲一,專案生,第1組,專案A",
  "s2@g.nccu.edu.tw,甲二,專案生,第1組,專案A",
  "s3@g.nccu.edu.tw,乙一,專案生,第2組,專案B",
  "pm1@g.nccu.edu.tw,幹部,專案幹部,,",
].join("\n");

describe("importRoster", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("匯入後：2 組、每組 1 條專案線、成員歸組", async () => {
    asAdmin(null);
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
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

  it("CSV 有錯就一筆都不寫入", async () => {
    asAdmin(null);
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    const badCsv = [
      "email,姓名,角色,組別,專案名稱",
      "s1@g.nccu.edu.tw,甲一,學生,第1組,專案A",
    ].join("\n");
    const r = await importRoster(semesterId, badCsv);
    expect(r).toEqual({ ok: false, errors: ["第 2 列：角色「學生」不是 專案幹部／其他幹部／專案生"] });

    const svc = createServiceSupabase();
    const { count } = await svc.from("members").select("id", { count: "exact", head: true }).eq("semester_id", semesterId);
    expect(count).toBe(0);
  });

  it("已經匯入過的學期不能再整批匯入", async () => {
    asAdmin(null);
    const { createSemester, importRoster } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
    await importRoster(semesterId, CSV_OK);
    const r = await importRoster(semesterId, CSV_OK);
    expect(r).toEqual({ ok: false, errors: ["本學期已匯入名單；學期中的異動請用「換組」」"] });
  });
});

describe("savePeriods", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("依日期排序編成第 1、2、3 期，截止時間照台北時間存", async () => {
    asAdmin(null);
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
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
    asAdmin(null);
    const { createSemester, savePeriods } = await import("@/server/actions/admin");
    const { semesterId } = await createSemester("115-1");
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

  it("已經有組別交了進度，不能再改期別", async () => {
    const seed = await seedSemester(); // seedSemester 已經插入一筆 progress_reports 在 periodIds[0]
    asAdmin(seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ date: "2026-10-01", time: "23:59" }]);
    expect(r).toEqual({ ok: false, errors: ["已經有組別交了進度，不能再改期別"] });
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
});

describe("setRedAfterHours", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("只收 1–720 的整數", async () => {
    const seed = await seedSemester();
    asAdmin(seed.semesterId);
    const { setRedAfterHours } = await import("@/server/actions/admin");
    await setRedAfterHours(seed.semesterId, 48);
    const svc = createServiceSupabase();
    const { data } = await svc.from("semesters").select("red_after_hours").eq("id", seed.semesterId).single();
    expect(data?.red_after_hours).toBe(48);

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
});
