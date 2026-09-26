import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";

// loadGroupDetail 走使用者身分連線（RLS 決定），管理員（沒有 member 列）才退回服務身分——
// 跟 dashboard-query.test.ts／checkin.test.ts 一樣用 vi.mock 假造 @/server/session，
// 把 createServerSupabase() 換成 clientAs() 簽出來的真實登入 client，讓 RLS 真的跑起來。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});
import { loadGroupDetail } from "@/server/queries/group-detail";

function asPm(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "pm@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "pm-id", semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  });
}

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "off-id", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  });
}

function asStudent(semesterId: string, groupId: string, email = "a1@g.nccu.edu.tw", name = "甲一") {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "s-id", semesterId, email, name, role: "student", groupId },
    semesterId,
  });
}

function asAdminNoMember(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  });
}

describe("loadGroupDetail", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("專案幹部讀得到任一組的三句話、誰交、紅燈說明", async () => {
    asPm(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    const result = await loadGroupDetail(seed.groupA);

    expect(result).not.toBeNull();
    expect(result!.group.name).toBe("第1組");
    const period1 = result!.periods.find((p) => p.seq === 1);
    expect(period1!.report).not.toBeNull();
    expect(period1!.report!.did).toBe("完成初版原型");
    expect(period1!.report!.submittedBy).toBe("甲一");
    expect(result!.checkins.length).toBeGreaterThan(0);
    expect(result!.checkins.some((c) => c.light === "red" && c.note === "卡在資料串接")).toBe(true);
  });

  it("其他幹部讀不到，回傳 null", async () => {
    asOfficer(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadGroupDetail(seed.groupA);
    expect(result).toBeNull();
  });

  it("學生讀自己組可以，別組回傳 null", async () => {
    asStudent(seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const own = await loadGroupDetail(seed.groupA);
    expect(own).not.toBeNull();

    const other = await loadGroupDetail(seed.groupB);
    expect(other).toBeNull();
  });

  it("管理員（沒有 member 列）讀得到", async () => {
    asAdminNoMember(seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin without member"));

    const result = await loadGroupDetail(seed.groupA);
    expect(result).not.toBeNull();
    expect(result!.group.name).toBe("第1組");
  });
});
