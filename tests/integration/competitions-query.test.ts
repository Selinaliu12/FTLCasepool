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

import { loadLobby, loadCompetition, loadAttachedGroups, loadCompetitionDetail } from "@/server/queries/competitions";

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

  // Fix round 1（F6）：loadAttachedGroups(id) 應該只回傳「那一場比賽」的組名——用兩場比賽各掛不
  // 同的組，確認拿 comps.soonId 不會混進 comps.laterId 掛的組（反過來也是）。之前的實作是撈全部
  // rows 再從 map 挑一個 key，這裡直接驗證窄化查詢本身的正確性，不只是最後結果剛好對。
  it("loadAttachedGroups(id) 不會把另一場比賽掛的組混進來", async () => {
    const service = createServiceSupabase();
    const { error: laterEntryError } = await service.from("competition_entries").insert({
      group_id: group3,
      competition_id: comps.laterId,
      created_by: "c1@g.nccu.edu.tw",
    });
    if (laterEntryError) throw laterEntryError;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    await expect(loadAttachedGroups(comps.soonId)).resolves.toEqual(["第1組", "第3組"]);
    await expect(loadAttachedGroups(comps.laterId)).resolves.toEqual(["第3組"]);
  });

  // Fix round 1（F3）：自然排序的斷言之前只用第1組／第3組，跟純字典序（單一數字比較）結果一樣，
  // 沒有真的驗證到「數字感知」這個規則。第10組跟第2組在字典序下會是「第10組」排在「第2組」前面
  // （'1' < '2'），只有數字感知排序才會把第2組排在第10組前面。
  it("自然排序：第2組在第10組前面（不是字典序）", async () => {
    const service = createServiceSupabase();
    const { data: group10, error: group10Error } = await service
      .from("groups")
      .insert({ semester_id: seed.semesterId, name: "第10組", project_name: "專案J" })
      .select()
      .single();
    if (group10Error) throw group10Error;

    const { error: g2EntryError } = await service.from("competition_entries").insert({
      group_id: seed.groupB, // 第2組，這裡不退出（跟共用 beforeEach 裡對 comps.soonId 的退出是不同筆報名）
      competition_id: comps.laterId,
      created_by: "b1@g.nccu.edu.tw",
    });
    if (g2EntryError) throw g2EntryError;
    const { error: g10EntryError } = await service.from("competition_entries").insert({
      group_id: group10.id,
      competition_id: comps.laterId,
      created_by: "j1@g.nccu.edu.tw",
    });
    if (g10EntryError) throw g10EntryError;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    await expect(loadAttachedGroups(comps.laterId)).resolves.toEqual(["第2組", "第10組"]);
  });
});

// Task 4：詳細頁 /competitions/[id] 用的 loader。可見性跟 loadCompetition（編輯頁）不一樣——
// 已發布的比賽所有人都看得到，草稿只有幹部／管理員看得到；其餘情況（別學期、亂填 id）一律 null。
describe("loadCompetitionDetail", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let comps: Awaited<ReturnType<typeof seedCompetitions>>;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
    comps = await seedCompetitions(seed.semesterId);
  });

  it("學生讀已發布的比賽，回傳資料", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const result = await loadCompetitionDetail(comps.soonId);
    expect(result).not.toBeNull();
    expect(result!.card.name).toBe("近期截止");
    expect(result!.canEdit).toBe(false);
    expect(result!.isStudent).toBe(true);
  });

  it("學生讀草稿，回傳 null", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    await expect(loadCompetitionDetail(comps.draftId)).resolves.toBeNull();
  });

  it("其他幹部讀草稿，回傳資料", async () => {
    asOfficer(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadCompetitionDetail(comps.draftId);
    expect(result).not.toBeNull();
    expect(result!.card.name).toBe("草稿賽");
    expect(result!.canEdit).toBe(true);
  });

  it("上學期的比賽，回傳 null", async () => {
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
        name: "別學期的比賽",
        url: "https://example.com/other-semester",
        signup_deadline: "2026-12-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (otherCompError) throw otherCompError;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    await expect(loadCompetitionDetail(otherComp.id as string)).resolves.toBeNull();
  });

  it("亂填的 id 回傳 null", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    await expect(loadCompetitionDetail("not-a-uuid")).resolves.toBeNull();
  });

  it("學生已掛過的比賽，attachedEntryId 有值；attachedGroups 帶出組名", async () => {
    const service = createServiceSupabase();
    const { error: entryError } = await service.from("competition_entries").insert({
      group_id: seed.groupA,
      competition_id: comps.soonId,
      created_by: "a1@g.nccu.edu.tw",
    });
    if (entryError) throw entryError;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const result = await loadCompetitionDetail(comps.soonId);
    expect(result!.attachedEntryId).not.toBeNull();
    expect(result!.attachedGroups).toEqual(["第1組"]);
  });

  it("幹部讀已發布的比賽，canEdit 為 true，isStudent 為 false", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    const result = await loadCompetitionDetail(comps.soonId);
    expect(result!.canEdit).toBe(true);
    expect(result!.isStudent).toBe(false);
    expect(result!.attachedEntryId).toBeNull();
  });

  // Task 4 fix round 1（F2）：管理員（沒有 member 列，走服務身分）的分支之前只間接被
  // loadCompetition／loadLobby 的測試覆蓋到，這裡直接測 loadCompetitionDetail 本身。
  it("管理員（沒有 member 列，走服務身分）讀草稿，回傳資料", async () => {
    asAdminNoMember(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin without member"));

    const result = await loadCompetitionDetail(comps.draftId);
    expect(result).not.toBeNull();
    expect(result!.card.name).toBe("草稿賽");
    expect(result!.canEdit).toBe(true);
  });

  it("管理員讀別學期的比賽，回傳 null", async () => {
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
        name: "別學期的比賽（管理員）",
        url: "https://example.com/other-semester-admin",
        signup_deadline: "2026-12-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (otherCompError) throw otherCompError;

    asAdminNoMember(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin without member"));

    await expect(loadCompetitionDetail(otherComp.id as string)).resolves.toBeNull();
  });
});
