import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, asStudent, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

import { loadMyGroup } from "@/server/queries/my-group";

async function createCompetition(semesterId: string, overrides: Record<string, unknown> = {}) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name: "黑客松",
      url: "https://example.com",
      signup_deadline: "2026-10-01T15:59:59.999Z",
      submission_deadline: "2026-11-01T15:59:59.999Z",
      final_date: "2026-12-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function confirmedEntry(groupId: string, competitionId: string) {
  const db = createServiceSupabase();
  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .insert({
      group_id: groupId,
      competition_id: competitionId,
      created_by: "a1@g.nccu.edu.tw",
      confirmed_at: new Date("2026-09-01T00:00:00Z").toISOString(),
    })
    .select()
    .single();
  if (entryError) throw entryError;

  const { data: line, error: lineError } = await db
    .from("lines")
    .insert({ group_id: groupId, kind: "competition", entry_id: entry.id })
    .select()
    .single();
  if (lineError) throw lineError;

  return { entryId: entry.id as string, lineId: line.id as string };
}

describe("loadMyGroup：比賽線", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("列出已確認報名的比賽線：狀態、三個階段、燈號、準時率", async () => {
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id as string);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const result = await loadMyGroup();
    expect(result.competitionLines).toHaveLength(1);
    const line = result.competitionLines[0];
    expect(line.entryId).toBe(entryId);
    expect(line.lineId).toBe(lineId);
    expect(line.competitionName).toBe("黑客松");
    expect(line.status).toBe("準備中");
    expect(line.stages.map((s) => s.key)).toEqual(["signup", "submission", "final"]);
    expect(line.stages.every((s) => s.required)).toBe(true);
    expect(line.display.light).toMatch(/^(red|yellow|green)$/);
    expect(line.onTime === null || typeof line.onTime === "number").toBe(true);
  });

  it("幹部改競賽日期後，已報名組的階段截止日立即更新（整合測試）", async () => {
    const competition = await createCompetition(seed.semesterId, { signup_deadline: "2026-10-01T15:59:59.999Z" });
    await confirmedEntry(seed.groupA, competition.id as string);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const before = await loadMyGroup();
    expect(before.competitionLines[0].stages.find((s) => s.key === "signup")!.deadline).toEqual(
      new Date("2026-10-01T15:59:59.999Z")
    );

    const db = createServiceSupabase();
    const { error } = await db
      .from("competitions")
      .update({ signup_deadline: "2026-09-20T15:59:59.999Z" })
      .eq("id", competition.id);
    if (error) throw error;

    const after = await loadMyGroup();
    expect(after.competitionLines[0].stages.find((s) => s.key === "signup")!.deadline).toEqual(
      new Date("2026-09-20T15:59:59.999Z")
    );
  });

  it("沒有掛任何比賽的組，competitionLines 是空陣列", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const result = await loadMyGroup();
    expect(result.competitionLines).toEqual([]);
  });

  it("別組的比賽線不會出現", async () => {
    const competition = await createCompetition(seed.semesterId);
    await confirmedEntry(seed.groupB, competition.id as string);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const result = await loadMyGroup();
    expect(result.competitionLines).toEqual([]);
  });

  it("已退出的報名仍會列出，狀態為已退出、沒有系統燈理由", async () => {
    const competition = await createCompetition(seed.semesterId);
    const { entryId } = await confirmedEntry(seed.groupA, competition.id as string);
    const db = createServiceSupabase();
    const { error } = await db.from("competition_entries").update({ withdrawn_at: new Date().toISOString() }).eq("id", entryId);
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const result = await loadMyGroup();
    expect(result.competitionLines).toHaveLength(1);
    expect(result.competitionLines[0].status).toBe("已退出");
    expect(result.competitionLines[0].display).toEqual({ light: "green", source: "系統：沒有欠交" });
  });
});
