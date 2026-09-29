import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, asStudent, asPm, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

import { loadMyGroupEntries, loadEntryDetail } from "@/server/queries/entries";
import { loadLobby } from "@/server/queries/competitions";

async function createCompetition(semesterId: string, name = "黑客松") {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name,
      url: "https://example.com",
      signup_deadline: "2099-12-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("loadMyGroupEntries", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("列出這組掛過的比賽與狀態", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    const db = createServiceSupabase();
    await db.from("competition_entries").insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" });

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const entries = await loadMyGroupEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].competitionName).toBe("黑客松");
    expect(entries[0].status).toBe("unconfirmed");
  });

  it("別組的報名不會出現", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    const db = createServiceSupabase();
    await db.from("competition_entries").insert({ group_id: seed.groupB, competition_id: competitionId, created_by: "b1@g.nccu.edu.tw" });

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const entries = await loadMyGroupEntries();
    expect(entries).toEqual([]);
  });
});

describe("loadEntryDetail", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
    const competitionId = await createCompetition(seed.semesterId);
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" })
      .select()
      .single();
    if (error) throw error;
    entryId = data.id as string;
  });

  it("回傳比賽資訊、組上的學生名單", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const detail = await loadEntryDetail(entryId);
    expect(detail).not.toBeNull();
    expect(detail!.competitionName).toBe("黑客松");
    expect(detail!.status).toBe("unconfirmed");
    expect(detail!.groupStudents.map((s) => s.name).sort()).toEqual(["甲一", "甲二"]);
  });

  // Controller ruling（fix round 1）：確認過的參賽成員如果換組，entry_members 那筆紀錄不會被
  // 刪掉，顯示的時候要標成 movedOut，不能直接從名單消失。
  it("已選的成員換組後，selectedMembers 標成 movedOut，不會消失", async () => {
    const db = createServiceSupabase();
    const { data: a2 } = await db
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a2@g.nccu.edu.tw")
      .single();
    await db.from("entry_members").insert({ entry_id: entryId, member_id: a2!.id });

    // a2 換到第2組。
    await db.from("members").update({ group_id: seed.groupB }).eq("id", a2!.id);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const detail = await loadEntryDetail(entryId);
    expect(detail).not.toBeNull();
    expect(detail!.selectedMembers).toEqual([{ id: a2!.id, name: "甲二", movedOut: true, left: false }]);
    // 換組之後不再是這組的學生，不會出現在勾選候選名單裡。
    expect(detail!.groupStudents.map((s) => s.id)).not.toContain(a2!.id);
  });

  it("別組的學生看不到（回傳 null）", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("b1@g.nccu.edu.tw"));
    const detail = await loadEntryDetail(entryId);
    expect(detail).toBeNull();
  });

  it("亂填 id 回傳 null", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const detail = await loadEntryDetail("not-a-uuid");
    expect(detail).toBeNull();
  });

  it("幹部呼叫回傳 null（這頁只給學生看）", async () => {
    asPm(mockGetAccess, seed.semesterId);
    const detail = await loadEntryDetail(entryId);
    expect(detail).toBeNull();
  });
});

describe("loadLobby：Task 3 的掛比賽按鈕資訊", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("學生看到 isStudent=true，掛過的比賽出現在 myGroupAttached", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    const db = createServiceSupabase();
    await db.from("competition_entries").insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" });

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const lobby = await loadLobby(new Date("2026-01-01T00:00:00Z"));
    expect(lobby.isStudent).toBe(true);
    expect(lobby.myGroupAttached[competitionId]).toBeDefined();
  });

  it("幹部看到 isStudent=false", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const lobby = await loadLobby(new Date("2026-01-01T00:00:00Z"));
    expect(lobby.isStudent).toBe(false);
    expect(lobby.myGroupAttached).toEqual({});
  });

  it("退出後的報名不會出現在 myGroupAttached", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    const db = createServiceSupabase();
    await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw", withdrawn_at: new Date().toISOString() });

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const lobby = await loadLobby(new Date("2026-01-01T00:00:00Z"));
    expect(lobby.myGroupAttached[competitionId]).toBeUndefined();
  });
});
