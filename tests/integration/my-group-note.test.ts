import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, asStudent, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// Task 4（規格 §14 第 7 點）：/my-group 顯示自己組的組員（姓名、系級，不含學號）與組別備註
// （含最後修改者、時間）。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

import { loadMyGroup } from "@/server/queries/my-group";

describe("loadMyGroup：組員清單與組別備註", () => {
  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
  });

  it("回傳自己組的組員（姓名、系級，依姓名排序）與備註（含最後修改者、時間）", async () => {
    const seed = await seedSemester();
    const db = createServiceSupabase();
    await db.from("members").update({ dept_year: "資科三" }).eq("semester_id", seed.semesterId).eq("email", "a1@g.nccu.edu.tw");
    const updatedAt = new Date("2026-09-20T03:00:00Z").toISOString();
    await db.from("groups").update({ note: "智慧記帳系統", note_updated_by: "甲二", note_updated_at: updatedAt }).eq("id", seed.groupA);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const data = await loadMyGroup();

    expect(data.members).toEqual([
      { name: "甲一", deptYear: "資科三" },
      { name: "甲二", deptYear: null },
    ]);
    expect(data.note).toBe("智慧記帳系統");
    expect(data.noteUpdatedBy).toBe("甲二");
    expect(data.noteUpdatedAt).toEqual(new Date(updatedAt));
  });

  it("沒有備註時 note／noteUpdatedBy／noteUpdatedAt 都是 null", async () => {
    const seed = await seedSemester();
    asStudent(mockGetAccess, seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("b1@g.nccu.edu.tw"));

    const data = await loadMyGroup();
    expect(data.note).toBeNull();
    expect(data.noteUpdatedBy).toBeNull();
    expect(data.noteUpdatedAt).toBeNull();
  });

  it("只帶出自己這組的組員，不會混進別組", async () => {
    const seed = await seedSemester();
    asStudent(mockGetAccess, seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("b1@g.nccu.edu.tw"));

    const data = await loadMyGroup();
    expect(data.members).toEqual([{ name: "乙一", deptYear: null }]);
  });
});
