import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, asPm, asOfficer, asStudent, asAdminNoMember } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";
import { NOT_ACKNOWLEDGED_ERROR } from "@/server/queries/acknowledgement";

const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { attachCompetition, setEntryMembers, confirmEntry, withdrawEntry } from "@/server/actions/entries";
import { moveMember } from "@/server/actions/admin";

function asAdmin(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  });
}

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
    seed = await seedSemester({ acknowledged: true });
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

  // Minor 9（fix round 1）：斷言確切的錯誤訊息，不是只看 ok:false。
  it("幹部呼叫被拒：只有專案生可以操作比賽報名", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asPm(mockGetAccess, seed.semesterId);
    const result = await attachCompetition(competitionId);
    expect(result).toEqual({ ok: false, error: "只有專案生可以操作比賽報名" });
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

  // Minor 9（fix round 1）：兩個請求同時掛同一場比賽——都通過「查有沒有 existing」的檢查之後，
  // 其中一個 insert 先成功，另一個撞部分唯一索引（23505），attachCompetition() 要把這個
  // Postgres 錯誤碼轉成使用者看得懂的「已經掛在你們組了」，不是未處理的例外。
  it("併發重複掛：一個成功、一個回傳已經掛在你們組了（23505 路徑）", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);

    const [r1, r2] = await Promise.all([attachCompetition(competitionId), attachCompetition(competitionId)]);
    const results = [r1, r2];
    const oks = results.filter((r) => r.ok);
    const fails = results.filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toEqual({ ok: false, error: "這場比賽已經掛在你們組了" });

    const db = createServiceSupabase();
    const { data } = await db
      .from("competition_entries")
      .select("id")
      .eq("group_id", seed.groupA)
      .eq("competition_id", competitionId)
      .is("withdrawn_at", null);
    expect(data).toHaveLength(1);
  });
});

describe("setEntryMembers", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester({ acknowledged: true });
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

  // Minor 5（fix round 1）：確切訊息「只能勾選自己組的專案生」，不是泛用的
  // 「請至少勾選一位參賽成員」。
  it("勾別組的人被拒：只能勾選自己組的專案生", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const otherIds = await studentIds(seed.semesterId, seed.groupB);
    const result = await setEntryMembers(entryId, [otherIds[0]]);
    expect(result).toEqual({ ok: false, error: "只能勾選自己組的專案生" });
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

  // IMPORTANT 1（fix round 1）：確認後還是可以改參賽成員（規格「確認後不能再改參賽成員以外的
  // 設定」——參賽成員本身不在「以外」）。
  it("確認報名後還是可以編輯參賽成員", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    const confirmed = await confirmEntry(entryId, [ids[0]]);
    expect(confirmed.ok).toBe(true);

    const result = await setEntryMembers(entryId, [ids[0], ids[1]]);
    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data } = await db.from("entry_members").select("member_id").eq("entry_id", entryId);
    expect((data ?? []).map((r) => r.member_id).sort()).toEqual([ids[0], ids[1]].sort());

    // 確認報名建立的線不會因為改參賽成員而重複建立／消失。
    const { data: lines } = await db.from("lines").select("id").eq("entry_id", entryId);
    expect(lines).toHaveLength(1);
  });

  // Important（fix round 2）：一個已經勾選、後來換到別組的成員，仍然可以用剩下（還在這組）
  // 的成員名單成功改參賽成員——update_entry_members() 本身沒有問題（fix round 1 就已經測過
  // 「勾別組的人被拒」），這裡是端到端驗證「換組之後，交一份不含那個人的新名單」這個實際
  // 會發生的操作路徑本身是通的（UI 那邊的 bug 在 entry-actions.tsx，component test 另外測）。
  it("成員換組後，setEntryMembers 送一份只含目前組員的名單會成功", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    await confirmEntry(entryId, [ids[0], ids[1]]);

    asAdmin(seed.semesterId);
    await moveMember(ids[1], seed.groupB);

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await setEntryMembers(entryId, [ids[0]]);
    expect(result).toEqual({ ok: true });

    const db = createServiceSupabase();
    const { data } = await db.from("entry_members").select("member_id").eq("entry_id", entryId);
    expect((data ?? []).map((r) => r.member_id)).toEqual([ids[0]]);
  });

  // IMPORTANT 1（fix round 1）：退出後不能再編輯參賽成員。
  it("取消報名（退出）後不能再編輯參賽成員", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    await confirmEntry(entryId, [ids[0]]);
    await withdrawEntry(entryId);

    const result = await setEntryMembers(entryId, [ids[0], ids[1]]);
    expect(result).toEqual({ ok: false, error: "找不到這筆報名" });
  });
});

describe("confirmEntry", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester({ acknowledged: true });
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

  // Controller ruling（fix round 1）：報名截止日不擋確認報名——組上可能已經在官方管道報名
  // 成功，只是這裡確認得比較晚。
  it("過了報名截止日還是可以確認報名", async () => {
    const db = createServiceSupabase();
    const { error } = await db
      .from("competitions")
      .update({ signup_deadline: "2020-01-01T15:59:59.999Z" })
      .eq("id", (await db.from("competition_entries").select("competition_id").eq("id", entryId).single()).data!.competition_id);
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    const result = await confirmEntry(entryId, [ids[0]]);
    expect(result.ok).toBe(true);
  });
});

describe("withdrawEntry", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let entryId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester({ acknowledged: true });
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

  // Controller ruling 4（fix round 1）：取消一筆「還沒確認」的報名，跟同一筆報名的確認報名
  // 真的同時發生（Promise.all，兩個請求幾乎同時讀到「還沒確認／還沒退出」）。不管誰先誰後，
  // 都不該丟出未處理的例外（500，原本的成因是 delete 撞到 lines.entry_id 的外鍵——
  // confirmEntry() 已經插入一條指到這筆報名的線，withdrawEntry() 卻還想把整筆刪掉）。加了
  // .is("confirmed_at", null) 之後，如果 confirm 先贏，withdraw 的 delete 會影響 0 筆、落到
  // 「已確認」的 update 分支；最終狀態一定是：要嘛從沒被確認過（entry 被刪掉），要嘛確認成功
  // 且對應的線還在（不管 withdrawn_at 有沒有在這次也被設進去）。
  it("取消未確認的報名時如果跟確認報名真的撞在一起，不會丟出未處理的例外", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);

    const [confirmResult, withdrawResult] = await Promise.all([
      confirmEntry(entryId, [ids[0]]),
      withdrawEntry(entryId),
    ]);
    void withdrawResult;

    const db = createServiceSupabase();
    const { data: entry } = await db.from("competition_entries").select("id, confirmed_at, withdrawn_at").eq("id", entryId).maybeSingle();

    if (confirmResult.ok) {
      // 確認贏了：報名這筆 row 還在（withdrawEntry 對已確認的報名一律用 update，不會刪除），
      // 對應的線永遠都在。
      expect(entry).not.toBeNull();
      const { data: line } = await db.from("lines").select("id").eq("id", confirmResult.lineId).maybeSingle();
      expect(line).not.toBeNull();
    } else {
      // 取消贏了（在確認送出 RPC 之前就把整筆刪掉了）：確認報名應該也感知到「找不到這筆報名」
      // 或類似的失敗，不會留下孤兒的 entry_members／lines。
      expect(entry).toBeNull();
    }
  });

  // Minor 7（fix round 1）：兩個同時送出的取消報名——只有一個應該「成功」，另一個回傳
  // 找不到這筆報名，不是兩個都回傳成功。
  it("併發取消已確認的報名：只有一個成功", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const ids = await studentIds(seed.semesterId, seed.groupA);
    const confirmed = await confirmEntry(entryId, [ids[0]]);
    if (!confirmed.ok) throw new Error("setup failed");

    const [r1, r2] = await Promise.all([withdrawEntry(entryId), withdrawEntry(entryId)]);
    const results = [r1, r2];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });
});

describe("acknowledgementRequired guard", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    // acknowledged: false（預設）——這批測試專門驗證還沒按過「我已了解」的學生打不進任何一個
    // 比賽動作。
    seed = await seedSemester();
  });

  it("attachCompetition：還沒按過我已了解被拒", async () => {
    const competitionId = await createCompetition(seed.semesterId);
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await attachCompetition(competitionId);
    expect(result).toEqual({ ok: false, error: NOT_ACKNOWLEDGED_ERROR });
  });

  it("setEntryMembers：還沒按過我已了解被拒", async () => {
    const db = createServiceSupabase();
    const competitionId = await createCompetition(seed.semesterId);
    const { data: entry, error } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" })
      .select()
      .single();
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await setEntryMembers(entry.id as string, []);
    expect(result).toEqual({ ok: false, error: NOT_ACKNOWLEDGED_ERROR });
  });

  it("confirmEntry：還沒按過我已了解被拒", async () => {
    const db = createServiceSupabase();
    const competitionId = await createCompetition(seed.semesterId);
    const { data: entry, error } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" })
      .select()
      .single();
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await confirmEntry(entry.id as string, []);
    expect(result).toEqual({ ok: false, error: NOT_ACKNOWLEDGED_ERROR });
  });

  it("withdrawEntry：還沒按過我已了解被拒", async () => {
    const db = createServiceSupabase();
    const competitionId = await createCompetition(seed.semesterId);
    const { data: entry, error } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" })
      .select()
      .single();
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    const result = await withdrawEntry(entry.id as string);
    expect(result).toEqual({ ok: false, error: NOT_ACKNOWLEDGED_ERROR });
  });
});
