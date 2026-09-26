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
});
