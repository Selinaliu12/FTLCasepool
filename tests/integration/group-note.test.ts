import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, okAccess } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// updateGroupNote：以目前身份判斷是不是該組的專案生；跟 checkin.test.ts 一樣用 vi.mock 假造
// @/server/session，讓每個測試自己決定呼叫者的目前身份。寫入本身走 service client 呼叫
// update_group_note() SECURITY DEFINER 函式，不受 RLS 影響，測試裡直接讀 groups 表驗證結果。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const REJECTED = "只有專案生可以修改組別備註";

function asStudent(semesterId: string, groupId: string, email = "a1@g.nccu.edu.tw", name = "甲一") {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "m1", semesterId, email, name, role: "student", groupId },
    semesterId,
  }));
}

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m2", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  }));
}

function asPm(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "pm@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m3", semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  }));
}

async function groupRow(groupId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db.from("groups").select("note, note_updated_by, note_updated_at").eq("id", groupId).single();
  if (error) throw error;
  return data;
}

describe("updateGroupNote", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("該組專案生送出，寫入備註、記錄姓名與時間", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");

    const { updateGroupNote } = await import("@/server/actions/group-note");
    // DB 時鐘可能比 Node 快個幾百毫秒（曾實測領先 ~210ms），所以這裡容忍 ±2 秒的時鐘偏移，
    // 而不是直接比對 before/after，避免測試偶發性失敗。
    const CLOCK_SKEW_TOLERANCE_MS = 2000;
    const before = new Date();
    const result = await updateGroupNote("智慧記帳系統");
    const after = new Date();

    expect(result).toEqual({ ok: true });

    const row = await groupRow(seed.groupA);
    expect(row.note).toBe("智慧記帳系統");
    expect(row.note_updated_by).toBe("甲一");
    const at = new Date(row.note_updated_at as string).getTime();
    expect(at).toBeGreaterThanOrEqual(before.getTime() - CLOCK_SKEW_TOLERANCE_MS);
    expect(at).toBeLessThanOrEqual(after.getTime() + CLOCK_SKEW_TOLERANCE_MS);
  });

  it("空白備註存成 null", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");

    const { updateGroupNote } = await import("@/server/actions/group-note");
    const result = await updateGroupNote("   ");
    expect(result).toEqual({ ok: true });

    const row = await groupRow(seed.groupA);
    expect(row.note).toBeNull();
  });

  it("超過 200 字 → 被拒，回『備註最多 200 字』，不寫入", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");

    const { updateGroupNote } = await import("@/server/actions/group-note");
    const result = await updateGroupNote("字".repeat(201));
    expect(result).toEqual({ ok: false, error: "備註最多 200 字" });

    const row = await groupRow(seed.groupA);
    expect(row.note).toBeNull();
  });

  it("其他幹部（非專案生）→ 被拒，回『只有專案生可以修改組別備註』", async () => {
    const seed = await seedSemester();
    asOfficer(seed.semesterId);

    const { updateGroupNote } = await import("@/server/actions/group-note");
    const result = await updateGroupNote("換個主題");
    expect(result).toEqual({ ok: false, error: REJECTED });

    const row = await groupRow(seed.groupA);
    expect(row.note).toBeNull();
  });

  it("專案幹部（非專案生）→ 同樣被拒", async () => {
    const seed = await seedSemester();
    asPm(seed.semesterId);

    const { updateGroupNote } = await import("@/server/actions/group-note");
    const result = await updateGroupNote("換個主題");
    expect(result).toEqual({ ok: false, error: REJECTED });
  });

  it("不在名單上的人 → 被拒，收到同一句錯誤", async () => {
    await seedSemester();
    mockGetAccess.mockResolvedValue({ kind: "not_in_roster" });

    const { updateGroupNote } = await import("@/server/actions/group-note");
    const result = await updateGroupNote("換個主題");
    expect(result).toEqual({ ok: false, error: REJECTED });
  });

  // Fix round 1 F6：active identity 指到一個不存在的組（理論上不該發生，例如身份在寫入當下
  // 剛好失效）——update_group_note() 現在在 0 列被改到時 raise "group_not_found"，action 把它
  // 映成既有的拒絕文案，不透露「這個組存在與否」，也不會默默回傳假的成功。
  it("active identity 的 groupId 不存在時 → 回同一句拒絕文案，不是假的成功", async () => {
    const seed = await seedSemester();
    mockGetAccess.mockResolvedValue(
      okAccess({
        kind: "ok",
        email: "a1@g.nccu.edu.tw",
        isAdmin: false,
        member: {
          id: "m1",
          semesterId: seed.semesterId,
          email: "a1@g.nccu.edu.tw",
          name: "甲一",
          role: "student",
          groupId: "00000000-0000-0000-0000-000000000000",
          groupName: "不存在的組",
        },
        semesterId: seed.semesterId,
      })
    );

    const { updateGroupNote } = await import("@/server/actions/group-note");
    const result = await updateGroupNote("換個主題");
    expect(result).toEqual({ ok: false, error: REJECTED });
  });

  it("第2組學生只能改第2組的備註，不會動到第1組", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");

    const { updateGroupNote } = await import("@/server/actions/group-note");
    const result = await updateGroupNote("第2組的主題");
    expect(result).toEqual({ ok: true });

    expect((await groupRow(seed.groupB)).note).toBe("第2組的主題");
    expect((await groupRow(seed.groupA)).note).toBeNull();
  });
});
