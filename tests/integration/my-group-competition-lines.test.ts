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

  // Final review IMPORTANT 1b：比賽那一列讀不到（例如舊資料被取消發布成草稿，RLS 擋掉）時，
  // 不能用 new Date(0) 當報名截止日——那會變成紅燈「報名逾期 2xxxx 天」。讀不到的線整條跳過，
  // 絕對不產生燈號。
  it("比賽讀不到（草稿被 RLS 擋掉）時跳過這條線，不會捏造截止日產生燈號", async () => {
    const competition = await createCompetition(seed.semesterId);
    await confirmedEntry(seed.groupA, competition.id as string);
    const db = createServiceSupabase();
    const { error } = await db.from("competitions").update({ status: "draft" }).eq("id", competition.id);
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const result = await loadMyGroup();
    expect(result.competitionLines.filter((l) => l.light !== null)).toEqual([]);
    expect(result.competitionLines).toEqual([]);
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
    expect(line.light).toMatch(/^(red|yellow|green)$/);
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

  // fix round 1（controller ruling）：已退出的線 light 是 null，不是綠燈——兩者意義不同
  // （null＝已結束，不畫 LightBadge）。
  it("已退出的報名仍會列出，狀態為已退出、light 為 null", async () => {
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
    expect(result.competitionLines[0].light).toBeNull();
    expect(result.competitionLines[0].source).toBeNull();
  });

  // fix round 1：得獎、且有一個階段被退回沒重交的線，light 仍是 null（已結束不判燈），
  // status 是得獎。
  it("得獎的報名：status 為得獎，light 為 null（即使有一個階段被退回）", async () => {
    const competition = await createCompetition(seed.semesterId);
    const { entryId, lineId } = await confirmedEntry(seed.groupA, competition.id as string);
    const db = createServiceSupabase();
    const { error: resultError } = await db
      .from("competition_entries")
      .update({ result: "awarded" })
      .eq("id", entryId);
    if (resultError) throw resultError;
    const { error: subError } = await db.from("stage_submissions").insert({
      line_id: lineId,
      stage: "signup",
      version: 1,
      pdf_key: `stage-submissions/${lineId}/signup-v1.pdf`,
      pdf_size: 1024,
      pdf_uploaded_at: new Date().toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
      submitted_by: "a1@g.nccu.edu.tw",
      review_status: "returned",
    });
    if (subError) throw subError;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const result = await loadMyGroup();
    expect(result.competitionLines).toHaveLength(1);
    expect(result.competitionLines[0].status).toBe("得獎");
    expect(result.competitionLines[0].light).toBeNull();
    expect(result.competitionLines[0].source).toBeNull();
  });
});
