import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs, asPm, asOfficer, asStudent, asAdminNoMember } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

import { loadLobby, loadCompetition, loadAttachedGroups } from "@/server/queries/competitions";

async function seedCompetitions(semesterId: string) {
  const db = createServiceSupabase();
  const { data: draft, error: draftError } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name: "草稿賽",
      url: "https://example.com/draft",
      signup_deadline: "2026-12-01T15:59:59.999Z",
      status: "draft",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (draftError) throw draftError;

  const { data: soon, error: soonError } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name: "近期截止",
      url: "https://example.com/soon",
      signup_deadline: "2026-11-05T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (soonError) throw soonError;

  const { data: later, error: laterError } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name: "較晚截止",
      url: "https://example.com/later",
      signup_deadline: "2026-12-10T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (laterError) throw laterError;

  const { data: closed, error: closedError } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name: "已截止",
      url: "https://example.com/closed",
      signup_deadline: "2026-01-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (closedError) throw closedError;

  return {
    draftId: draft.id as string,
    soonId: soon.id as string,
    laterId: later.id as string,
    closedId: closed.id as string,
  };
}

const NOW = new Date("2026-06-01T00:00:00Z");

describe("loadLobby", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let comps: Awaited<ReturnType<typeof seedCompetitions>>;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
    comps = await seedCompetitions(seed.semesterId);
  });

  it("學生只看得到已發布的，依報名截止日排序，看不到草稿", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const lobby = await loadLobby(NOW);
    expect(lobby.canEdit).toBe(false);
    expect(lobby.drafts).toEqual([]);
    expect(lobby.open.map((c) => c.id)).toEqual([comps.soonId, comps.laterId]);
    expect(lobby.closed.map((c) => c.id)).toEqual([comps.closedId]);
  });

  it("專案幹部看得到草稿與已發布，canEdit 為 true", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    const lobby = await loadLobby(NOW);
    expect(lobby.canEdit).toBe(true);
    expect(lobby.drafts.map((c) => c.id)).toEqual([comps.draftId]);
    expect(lobby.open.map((c) => c.id)).toEqual([comps.soonId, comps.laterId]);
  });

  it("其他幹部也看得到草稿，canEdit 為 true", async () => {
    asOfficer(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const lobby = await loadLobby(NOW);
    expect(lobby.canEdit).toBe(true);
    expect(lobby.drafts.map((c) => c.id)).toEqual([comps.draftId]);
  });

  it("管理員（沒有 member 列）看得到全部，canEdit 為 true", async () => {
    asAdminNoMember(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin without member"));

    const lobby = await loadLobby(NOW);
    expect(lobby.canEdit).toBe(true);
    expect(lobby.drafts.map((c) => c.id)).toEqual([comps.draftId]);
  });

  // Minor 6（controller ruling，fix round 1）：草稿也要依報名截止日由近到遠排序，不是資料庫
  // 回傳的原始（建立）順序。額外建一筆比既有草稿（12/01）截止日更早（11/20）的草稿，
  // 確認它排在前面。
  it("草稿依報名截止日由近到遠排序", async () => {
    const db = createServiceSupabase();
    const { data: earlierDraft, error } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "更早截止的草稿",
        url: "https://example.com/earlier-draft",
        signup_deadline: "2026-11-20T15:59:59.999Z",
        status: "draft",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (error) throw error;

    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    const lobby = await loadLobby(NOW);
    expect(lobby.drafts.map((c) => c.id)).toEqual([earlierDraft.id as string, comps.draftId]);
  });
});

describe("loadCompetition", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let comps: Awaited<ReturnType<typeof seedCompetitions>>;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
    comps = await seedCompetitions(seed.semesterId);
  });

  it("幹部讀得到草稿", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    const result = await loadCompetition(comps.draftId);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("草稿賽");
  });

  it("學生讀不到（回傳 null，頁面轉 404）", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const result = await loadCompetition(comps.draftId);
    expect(result).toBeNull();
  });

  it("亂填的 id 回傳 null", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    await expect(loadCompetition("abc")).resolves.toBeNull();
  });

  // Minor 1（controller ruling，fix round 1）：id 格式正確、幹部身分也對，但這場比賽屬於別的
  // 學期——loadCompetition 用 `.eq("semester_id", access.semesterId)` 擋掉，回傳 null（頁面轉
  // 404），不能因為呼叫者是幹部就看得到別學期的資料。
  it("格式正確、幹部身分也對，但屬於別的學期的比賽，回傳 null", async () => {
    const service = createServiceSupabase();
    const { data: otherSemester, error: otherSemesterError } = await service
      .from("semesters")
      .insert({ name: "別的學期", is_current: false })
      .select()
      .single();
    if (otherSemesterError) throw otherSemesterError;

    const { data: otherComp, error: otherCompError } = await service
      .from("competitions")
      .insert({
        semester_id: otherSemester.id,
        name: "別學期的草稿",
        url: "https://example.com/other-semester-draft",
        signup_deadline: "2026-12-01T15:59:59.999Z",
        status: "draft",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (otherCompError) throw otherCompError;

    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    await expect(loadCompetition(otherComp.id as string)).resolves.toBeNull();
  });
});

// Task 2（規格第 15 節 #7）：loadLobby 的 attachedGroups 與 loadAttachedGroups() helper——
// 每組都看得到別組掛了哪些比賽的組名，管理員（沒有 member 列、走服務身分）走等價的
// service-side 查詢，兩邊結果要一致。
describe("attachedGroups（loadLobby／loadAttachedGroups）", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let comps: Awaited<ReturnType<typeof seedCompetitions>>;
  let group3: string;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
    comps = await seedCompetitions(seed.semesterId);

    const service = createServiceSupabase();
    const { data: g3, error: g3Error } = await service
      .from("groups")
      .insert({ semester_id: seed.semesterId, name: "第3組", project_name: "專案C" })
      .select()
      .single();
    if (g3Error) throw g3Error;
    group3 = g3.id as string;

    // 第1組掛「近期截止」；第2組掛「近期截止」後退出；第3組掛「近期截止」得獎（仍算掛上）。
    const { error: e1Error } = await service.from("competition_entries").insert({
      group_id: seed.groupA,
      competition_id: comps.soonId,
      created_by: "a1@g.nccu.edu.tw",
    });
    if (e1Error) throw e1Error;
    const { error: e2Error } = await service.from("competition_entries").insert({
      group_id: seed.groupB,
      competition_id: comps.soonId,
      created_by: "b1@g.nccu.edu.tw",
      withdrawn_at: new Date().toISOString(),
    });
    if (e2Error) throw e2Error;
    const { error: e3Error } = await service.from("competition_entries").insert({
      group_id: group3,
      competition_id: comps.soonId,
      created_by: "c1@g.nccu.edu.tw",
      result: "awarded",
    });
    if (e3Error) throw e3Error;
  });

  it("學生看得到大廳卡片的 attachedGroups：第1組、第3組（自然排序，退出的第2組不出現）", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const lobby = await loadLobby(NOW);
    expect(lobby.attachedGroups[comps.soonId]).toEqual(["第1組", "第3組"]);
    // 沒有人掛過的比賽：key 不存在（不是空陣列，元件層自行判斷 undefined／空陣列都不顯示）。
    expect(lobby.attachedGroups[comps.laterId]).toBeUndefined();
  });

  it("管理員（沒有 member 列，走服務身分）的 attachedGroups 跟學生看到的一致", async () => {
    asAdminNoMember(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin without member"));

    const lobby = await loadLobby(NOW);
    expect(lobby.attachedGroups[comps.soonId]).toEqual(["第1組", "第3組"]);
  });

  it("loadAttachedGroups(id) 回傳單一比賽的組名清單", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    await expect(loadAttachedGroups(comps.soonId)).resolves.toEqual(["第1組", "第3組"]);
    await expect(loadAttachedGroups(comps.laterId)).resolves.toEqual([]);
  });

  it("loadAttachedGroups：亂填的 id 回傳空陣列", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    await expect(loadAttachedGroups("not-a-uuid")).resolves.toEqual([]);
  });
});
