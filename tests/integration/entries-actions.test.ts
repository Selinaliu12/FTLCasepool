import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, asPm, asOfficer, asStudent, asAdminNoMember } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { attachCompetition, setEntryMembers, confirmEntry, withdrawEntry } from "@/server/actions/entries";

async function createCompetition(
  semesterId: string,
  overrides: Partial<{ status: string; signup_deadline: string; name: string }> = {}
) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("competitions")
    .insert({
      semester_id: semesterId,
      name: overrides.name ?? "黑客松",
      url: "https://example.com",
      signup_deadline: overrides.signup_deadline ?? "2099-12-01T15:59:59.999Z",
      status: overrides.status ?? "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}

async function studentIds(semesterId: string, groupId: string): Promise<string[]> {
  const db = createServiceSupabase();
  const { data, error } = await db.from("members").select("id").eq("semester_id", semesterId).eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []).map((m) => m.id as string);
}

describe("attachCompetition", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("學生把已發布、未過期的比賽掛到自己組", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);

    const result = await attachCompetition(competitionId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const db = createServiceSupabase();
    const { data } = await db.from("competition_entries").select("group_id, competition_id, created_by").eq("id", result.entryId).single();
    expect(data!.group_id).toBe(seed.groupA);
    expect(data!.competition_id).toBe(competitionId);
    expect(data!.created_by).toBe("a1@g.nccu.edu.tw");
  });

  it("重複掛同一場被拒：這場比賽已經掛在你們組了", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    await attachCompetition(competitionId);

    const result = await attachCompetition(competitionId);
    expect(result).toEqual({ ok: false, error: "這場比賽已經掛在你們組了" });
  });

  it("過了報名截止日被拒：已經過了報名截止日", async () => {
    const competitionId = await createCompetition(seed.semesterId, { signup_deadline: "2020-01-01T15:59:59.999Z" });
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);

    const result = await attachCompetition(competitionId);
    expect(result).toEqual({ ok: false, error: "已經過了報名截止日" });
  });

  it("草稿回傳找不到這場比賽", async () => {
    const competitionId = await createCompetition(seed.semesterId, { status: "draft" });
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);

    const result = await attachCompetition(competitionId);
    expect(result).toEqual({ ok: false, error: "找不到這場比賽" });
  });

  it("別的學期的比賽回傳找不到這場比賽", async () => {
    const db = createServiceSupabase();
    const { data: otherSemester, error } = await db.from("semesters").insert({ name: "別的學期", is_current: false }).select().single();
    if (error) throw error;
    const competitionId = await createCompetition(otherSemester.id as string);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await attachCompetition(competitionId);
    expect(result).toEqual({ ok: false, error: "找不到這場比賽" });
  });

  it("幹部呼叫被拒", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asPm(mockGetAccess, seed.semesterId);
    const result = await attachCompetition(competitionId);
    expect(result.ok).toBe(false);
  });

  // Review Focus 2：取消報名後可以重新掛同一場比賽（不同的 entryId）。
  it("取消報名後可以重新掛同一場", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const first = await attachCompetition(competitionId);
    if (!first.ok) throw new Error("setup failed");
    const withdraw = await withdrawEntry(first.entryId);
    expect(withdraw.ok).toBe(true);

    const second = await attachCompetition(competitionId);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.entryId).not.toBe(first.entryId);
  });
});

describe("setEntryMembers", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const attached = await attachCompetition(competitionId);
    if (!attached.ok) throw new Error("setup failed");
    entryId = attached.entryId;
  });

  it("勾自己組的專案生成功", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    const result = await setEntryMembers(entryId, [ids[0]]);
    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data } = await db.from("entry_members").select("member_id").eq("entry_id", entryId);
    expect((data ?? []).map((r) => r.member_id)).toEqual([ids[0]]);
  });

  it("沒勾任何人被拒：請至少勾選一位參賽成員", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await setEntryMembers(entryId, []);
    expect(result).toEqual({ ok: false, error: "請至少勾選一位參賽成員" });
  });

  it("勾別組的人被拒", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const otherIds = await studentIds(seed.semesterId, seed.groupB);
    const result = await setEntryMembers(entryId, [otherIds[0]]);
    expect(result.ok).toBe(false);
  });

  it("別組學生呼叫回傳找不到這筆報名", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    const result = await setEntryMembers(entryId, []);
    expect(result).toEqual({ ok: false, error: "找不到這筆報名" });
  });

  it("幹部呼叫回傳找不到這筆報名", async () => {
    asOfficer(mockGetAccess, seed.semesterId);
    const result = await setEntryMembers(entryId, []);
    expect(result).toEqual({ ok: false, error: "找不到這筆報名" });
  });
});

describe("confirmEntry", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const attached = await attachCompetition(competitionId);
    if (!attached.ok) throw new Error("setup failed");
    entryId = attached.entryId;
  });

  it("確認報名建立比賽線，並記下確認時間", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    const result = await confirmEntry(entryId, [ids[0], ids[1]]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const db = createServiceSupabase();
    const { data: entry } = await db.from("competition_entries").select("confirmed_at").eq("id", entryId).single();
    expect(entry!.confirmed_at).not.toBeNull();

    const { data: line } = await db.from("lines").select("kind, group_id, entry_id").eq("id", result.lineId).single();
    expect(line).toEqual({ kind: "competition", group_id: seed.groupA, entry_id: entryId });

    const { data: members } = await db.from("entry_members").select("member_id").eq("entry_id", entryId);
    expect((members ?? []).map((m) => m.member_id).sort()).toEqual([ids[0], ids[1]].sort());
  });

  it("沒勾任何人被拒：請至少勾選一位參賽成員", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await confirmEntry(entryId, []);
    expect(result).toEqual({ ok: false, error: "請至少勾選一位參賽成員" });

    const db = createServiceSupabase();
    const { data } = await db.from("lines").select("id").eq("entry_id", entryId);
    expect(data).toEqual([]);
  });

  it("確認過後不能再確認一次", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    await confirmEntry(entryId, [ids[0]]);
    const result = await confirmEntry(entryId, [ids[0]]);
    expect(result.ok).toBe(false);
  });

  it("別組學生呼叫回傳找不到這筆報名", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    const result = await confirmEntry(entryId, []);
    expect(result).toEqual({ ok: false, error: "找不到這筆報名" });
  });
});

describe("withdrawEntry", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const attached = await attachCompetition(competitionId);
    if (!attached.ok) throw new Error("setup failed");
    entryId = attached.entryId;
  });

  it("未確認的報名取消後整筆刪除", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await withdrawEntry(entryId);
    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data } = await db.from("competition_entries").select("id").eq("id", entryId).maybeSingle();
    expect(data).toBeNull();
  });

  it("已確認的報名取消後標成已退出，比賽線保留", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    const confirmed = await confirmEntry(entryId, [ids[0]]);
    if (!confirmed.ok) throw new Error("setup failed");

    const result = await withdrawEntry(entryId);
    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data: entry } = await db.from("competition_entries").select("withdrawn_at").eq("id", entryId).single();
    expect(entry!.withdrawn_at).not.toBeNull();

    const { data: line } = await db.from("lines").select("id").eq("id", confirmed.lineId).maybeSingle();
    expect(line).not.toBeNull();
  });

  it("再取消一次回傳找不到這筆報名", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    await withdrawEntry(entryId);
    const result = await withdrawEntry(entryId);
    expect(result).toEqual({ ok: false, error: "找不到這筆報名" });
  });

  it("幹部呼叫回傳找不到這筆報名", async () => {
    asAdminNoMember(mockGetAccess, seed.semesterId);
    const result = await withdrawEntry(entryId);
    expect(result).toEqual({ ok: false, error: "找不到這筆報名" });
  });
});
