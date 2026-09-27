import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs, asPm, asOfficer, asStudent, asAdminNoMember, asAdminOfficer } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

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

describe("loadGroupDetail", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("專案幹部讀得到任一組的三句話、誰交、紅燈說明", async () => {
    asPm(mockGetAccess, seed.semesterId);
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
    asOfficer(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadGroupDetail(seed.groupA);
    expect(result).toBeNull();
  });

  it("學生讀自己組可以，別組回傳 null", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const own = await loadGroupDetail(seed.groupA);
    expect(own).not.toBeNull();

    const other = await loadGroupDetail(seed.groupB);
    expect(other).toBeNull();
  });

  it("管理員（沒有 member 列）讀得到", async () => {
    asAdminNoMember(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin without member"));

    const result = await loadGroupDetail(seed.groupA);
    expect(result).not.toBeNull();
    expect(result!.group.name).toBe("第1組");
  });

  // Controller ruling 3（Task 14 fix round 1）：管理員同時被匯入成其他幹部（member 列存在、
  // role 是 officer），身分還是「管理員 ✓」——之前的寫法（useService = isAdmin && !member）
  // 會讓這種人落到「其他幹部」的分支被擋下來，跟權限表衝突。
  it("管理員同時是名單上的其他幹部，也讀得到（走服務身分，不受 officer 規則影響）", async () => {
    const db = createServiceSupabase();
    const { data: member, error } = await db
      .from("members")
      .insert({ semester_id: seed.semesterId, email: "admin@g.nccu.edu.tw", name: "管理員兼其他幹部", role: "officer", group_id: null })
      .select()
      .single();
    if (error) throw error;

    asAdminOfficer(mockGetAccess, seed.semesterId, member.id as string);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin"));

    const result = await loadGroupDetail(seed.groupA);
    expect(result).not.toBeNull();
    expect(result!.group.name).toBe("第1組");
  });

  it("亂填的 id（不是 UUID 格式）回傳 null，不會丟例外", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    await expect(loadGroupDetail("abc")).resolves.toBeNull();
  });

  it("格式正確但不存在的 UUID 回傳 null", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    await expect(loadGroupDetail("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("帶出這組的比賽線狀態摘要", async () => {
    const db = createServiceSupabase();
    const { data: competition, error: competitionError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2026-10-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (competitionError) throw competitionError;

    const { data: entry, error: entryError } = await db
      .from("competition_entries")
      .insert({
        group_id: seed.groupA,
        competition_id: competition.id,
        created_by: "a1@g.nccu.edu.tw",
        confirmed_at: new Date("2026-09-01T00:00:00Z").toISOString(),
      })
      .select()
      .single();
    if (entryError) throw entryError;

    const { error: lineError } = await db.from("lines").insert({ group_id: seed.groupA, kind: "competition", entry_id: entry.id });
    if (lineError) throw lineError;

    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    const result = await loadGroupDetail(seed.groupA);
    expect(result).not.toBeNull();
    expect(result!.competitionLines).toHaveLength(1);
    expect(result!.competitionLines[0].competitionName).toBe("黑客松");
    expect(result!.competitionLines[0].status).toBe("準備中");
  });
});
