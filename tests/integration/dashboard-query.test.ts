import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// loadDashboard() 只能用使用者身分連線讀 groups／lines／periods／line_light_events／
// semesters／pm_assignments——跟 checkin.test.ts 一樣的手法：mock @/server/session 讓
// 測試自己決定呼叫者是誰，並把 createServerSupabase() 換成 clientAs() 簽出來的真實登入
// client，讓 RLS 真的跑起來。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});
import { loadDashboard } from "@/server/queries/dashboard";

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "off-id", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  });
}

function asPm(semesterId: string, pmMemberId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "pm@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: pmMemberId, semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", groupId: null },
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

const CONTENT_KEYS = ["did", "blocked", "next_steps", "pdf_key", "note"];

function deepScanForContentKeys(value: unknown): string[] {
  const found: string[] = [];
  const visit = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (CONTENT_KEYS.includes(k)) found.push(k);
        visit(val);
      }
    }
  };
  visit(value);
  return found;
}

describe("loadDashboard", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("其他幹部拿得到所有種子組別的燈號、來源與準時率，回傳資料裡沒有三句話／PDF key／紅燈說明欄位", async () => {
    asOfficer(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadDashboard(new Date("2026-10-05T00:00:00Z"));

    expect(result.cards).toHaveLength(2);
    const names = result.cards.map((c) => c.groupName).sort();
    expect(names).toEqual(["第1組", "第2組"]);
    for (const card of result.cards) {
      expect(card.lines).toHaveLength(1);
      expect(card.lines[0].light).toMatch(/^(red|yellow|green)$/);
      expect(typeof card.lines[0].source).toBe("string");
      expect(card.lines[0].onTime === null || typeof card.lines[0].onTime === "number").toBe(true);
    }
    expect(deepScanForContentKeys(result)).toEqual([]);
    expect(result.myPmGroupIds).toEqual([]);
  });

  it("專案幹部指派後，myPmGroupIds 帶出自己負責的組別", async () => {
    const db = createServiceSupabase();
    const { data: pmMember, error } = await db
      .from("members")
      .select("id")
      .eq("semester_id", seed.semesterId)
      .eq("email", "pm@g.nccu.edu.tw")
      .single();
    if (error) throw error;
    const { error: assignError } = await db
      .from("pm_assignments")
      .insert({ pm_member_id: pmMember.id, group_id: seed.groupA });
    if (assignError) throw assignError;

    asPm(seed.semesterId, pmMember.id as string);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));

    const result = await loadDashboard(new Date("2026-10-05T00:00:00Z"));
    expect(result.myPmGroupIds).toEqual([seed.groupA]);
  });

  it("管理員（沒有 member 列）也拿得到全部組別、沒有內容欄位", async () => {
    asAdminNoMember(seed.semesterId);
    // 管理員沒有 member row，loadDashboard 應該退回 service client，完全不呼叫
    // createServerSupabase。跟前一個測試共用同一個 mock，如果不在這裡主動 reject，
    // 這個 mock 還留著前一個測試（PM）設的 resolved value（clientAs() 簽出來的 PM
    // client），就算 useService 這個判斷式壞掉、程式碼誤用了使用者身分連線，也會因為
    // is_staff()／read_groups 對 pm 一樣成立而「意外地」讀到全部 2 組，讓這個測試看起來
    // 還是綠的——完全沒驗證到「管理員這條路真的走了 service client」這件事。改成主動
    // reject，任何一步誤用使用者身分連線都會讓整個 loadDashboard() 直接炸開，測試才真的
    // 測到「一定沒有呼叫 createServerSupabase」。
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin"));

    const result = await loadDashboard(new Date("2026-10-05T00:00:00Z"));

    expect(result.cards).toHaveLength(2);
    expect(deepScanForContentKeys(result)).toEqual([]);
  });

  it("學生呼叫 loadDashboard 被拒絕", async () => {
    mockGetAccess.mockResolvedValue({
      kind: "ok",
      email: "a1@g.nccu.edu.tw",
      isAdmin: false,
      member: { id: "a1-id", semesterId: seed.semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId: seed.groupA },
      semesterId: seed.semesterId,
    });

    await expect(loadDashboard(new Date("2026-10-05T00:00:00Z"))).rejects.toThrow("只有幹部與管理員可以看總覽看板");
  });

  it("一組逾期 4 天：排最前、紅燈、來源『系統：第 1 期逾期 4 天』", async () => {
    const db = createServiceSupabase();
    const now = new Date("2026-10-05T00:00:00Z");
    const overdueDeadline = new Date(now.getTime() - 4 * 24 * 3_600_000);
    const { error } = await db.from("periods").update({ deadline: overdueDeadline.toISOString() }).eq("id", seed.periodIds[0]);
    if (error) throw error;
    // seedSemester() 幫第1組留了一筆紅燈的期中點燈（跟這個情境無關），先清掉，
    // 不然兩組都紅燈時「第2組排最前」這個斷言會被同色時的組名排序蓋過去。
    const { error: ciError } = await db.from("checkins").delete().eq("line_id", seed.lineA);
    if (ciError) throw ciError;

    asOfficer(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadDashboard(now);

    expect(result.cards[0].groupName).toBe("第2組");
    expect(result.cards[0].lines[0].light).toBe("red");
    expect(result.cards[0].lines[0].source).toBe("系統：第 1 期逾期 4 天");
  });

  it("組卡包含比賽線：報名逾期紅燈、比賽名稱當 label，並帶進 worstLight", async () => {
    const db = createServiceSupabase();
    // 用還沒到第 1 期截止日 (10/1) 的時間點，讓兩組的專案線都還是綠燈——這樣才能確認
    // 「整組排最前」是比賽線的紅燈帶出來的，不是專案線本身逾期。
    const now = new Date("2026-09-25T00:00:00Z");
    const overdueSignup = new Date(now.getTime() - 96 * 3_600_000);

    // 種子資料幫第1組留了一筆紅燈的期中點燈（跟這個情境無關），先清掉，不然兩組都紅燈時
    // 「第2組排最前」這個斷言會被同色時的組名排序蓋過去。
    const { error: ciError } = await db.from("checkins").delete().eq("line_id", seed.lineA);
    if (ciError) throw ciError;

    const { data: competition, error: competitionError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: overdueSignup.toISOString(),
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (competitionError) throw competitionError;

    const { data: entry, error: entryError } = await db
      .from("competition_entries")
      .insert({
        group_id: seed.groupB,
        competition_id: competition.id,
        created_by: "b1@g.nccu.edu.tw",
        confirmed_at: new Date("2026-09-01T00:00:00Z").toISOString(),
      })
      .select()
      .single();
    if (entryError) throw entryError;

    const { error: lineError } = await db
      .from("lines")
      .insert({ group_id: seed.groupB, kind: "competition", entry_id: entry.id });
    if (lineError) throw lineError;

    asOfficer(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadDashboard(now);
    const groupB = result.cards.find((c) => c.groupName === "第2組")!;
    const competitionLine = groupB.lines.find((l) => l.kind === "competition")!;
    expect(competitionLine.label).toBe("黑客松");
    expect(competitionLine.light).toBe("red");
    expect(competitionLine.source).toBe("系統：黑客松 報名逾期 4 天");
    // 排序看的是「組內所有線」最嚴重的燈：第2組的專案線是綠燈，但比賽線紅燈，整組還是要排最前面。
    expect(result.cards[0].groupName).toBe("第2組");
    expect(deepScanForContentKeys(result)).toEqual([]);
  });

  // fix round 1（controller ruling）：已退出的比賽線整條從看板濾掉，不是「顯示但沒有燈」。
  it("已退出的比賽線不會出現在組卡上", async () => {
    const db = createServiceSupabase();
    const now = new Date("2026-09-25T00:00:00Z");
    const { error: ciError } = await db.from("checkins").delete().eq("line_id", seed.lineA);
    if (ciError) throw ciError;

    const { data: competition, error: competitionError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2099-12-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (competitionError) throw competitionError;

    const { data: entry, error: entryError } = await db
      .from("competition_entries")
      .insert({
        group_id: seed.groupB,
        competition_id: competition.id,
        created_by: "b1@g.nccu.edu.tw",
        confirmed_at: new Date("2026-09-01T00:00:00Z").toISOString(),
        withdrawn_at: new Date("2026-09-10T00:00:00Z").toISOString(),
      })
      .select()
      .single();
    if (entryError) throw entryError;

    const { error: lineError } = await db
      .from("lines")
      .insert({ group_id: seed.groupB, kind: "competition", entry_id: entry.id });
    if (lineError) throw lineError;

    asOfficer(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadDashboard(now);
    const groupB = result.cards.find((c) => c.groupName === "第2組")!;
    expect(groupB.lines.some((l) => l.kind === "competition")).toBe(false);
  });

  // fix round 1（controller ruling）：得獎、且有一個階段被退回沒重交的線，light 是 null，
  // 不會被誤判成紅／黃燈而影響整組的排序——第2組的專案線是綠燈，比賽線已結束、不判燈，
  // 整組排序仍然看「有效」的燈，跟第1組（也是綠燈）同色依組名排序。
  it("得獎且有階段被退回的比賽線：light 為 null，不影響整組排序", async () => {
    const db = createServiceSupabase();
    const now = new Date("2026-09-25T00:00:00Z");
    const { error: ciError } = await db.from("checkins").delete().in("line_id", [seed.lineA, seed.lineB]);
    if (ciError) throw ciError;

    const { data: competition, error: competitionError } = await db
      .from("competitions")
      .insert({
        semester_id: seed.semesterId,
        name: "黑客松",
        url: "https://example.com",
        signup_deadline: "2026-08-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (competitionError) throw competitionError;

    const { data: entry, error: entryError } = await db
      .from("competition_entries")
      .insert({
        group_id: seed.groupB,
        competition_id: competition.id,
        created_by: "b1@g.nccu.edu.tw",
        confirmed_at: new Date("2026-07-01T00:00:00Z").toISOString(),
        result: "awarded",
      })
      .select()
      .single();
    if (entryError) throw entryError;

    const { data: line, error: lineError } = await db
      .from("lines")
      .insert({ group_id: seed.groupB, kind: "competition", entry_id: entry.id })
      .select()
      .single();
    if (lineError) throw lineError;

    const { error: subError } = await db.from("stage_submissions").insert({
      line_id: line.id,
      stage: "signup",
      version: 1,
      pdf_key: `stage-submissions/${line.id}/signup-v1.pdf`,
      pdf_size: 1024,
      pdf_uploaded_at: new Date("2026-07-15T00:00:00Z").toISOString(),
      pdf_uploaded_by: "b1@g.nccu.edu.tw",
      submitted_by: "b1@g.nccu.edu.tw",
      review_status: "returned",
    });
    if (subError) throw subError;

    asOfficer(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));

    const result = await loadDashboard(now);
    const groupB = result.cards.find((c) => c.groupName === "第2組")!;
    const competitionLine = groupB.lines.find((l) => l.kind === "competition")!;
    expect(competitionLine.light).toBeNull();
    expect(competitionLine.status).toBe("得獎");
    // 兩組都只剩綠燈的有效線 → 同色依組名排序，不會因為比賽線「看起來」有問題被排到最前面。
    expect(result.cards.map((c) => c.groupName)).toEqual(["第1組", "第2組"]);
  });
});
