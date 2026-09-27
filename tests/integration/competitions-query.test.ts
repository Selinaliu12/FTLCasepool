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

import { loadLobby, loadCompetition } from "@/server/queries/competitions";

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
});
