import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// submitCheckin 一律先呼叫 getAccess()；跟 progress-actions.test.ts 一樣用 vi.mock 假造
// @/server/session，讓每個測試自己決定呼叫者是誰。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
// submitCheckin 送出成功後呼叫 revalidatePath("/my-group")；測試不在真的 Next.js request
// context 裡跑，沒有 static generation store 可以 revalidate，跟 progress-actions 系列測試
// 一樣把 next/cache 整個 mock 掉，只關心「有沒有呼叫」不是「真的重新驗證」。
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

// loadMyGroup 用的是 user-scoped client（createServerSupabase），要驗證「送出後 loadMyGroup
// 看到什麼」，就要讓它在測試裡也讀到真正登入使用者的 RLS 視角——用 clientAs() 簽出來的
// session client 頂替掉 createServerSupabase()，其餘（createServiceSupabase）維持原樣。
const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});
import { clientAs, backdatePeriodDeadline } from "./helpers";

const REJECTED = "只有專案生可以點燈號";

function asStudent(semesterId: string, groupId: string, email = "a1@g.nccu.edu.tw", name = "甲一") {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "m1", semesterId, email, name, role: "student", groupId },
    semesterId,
  });
}

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m2", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  });
}

async function checkinsFor(lineId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db.from("checkins").select("*").eq("line_id", lineId).order("created_at");
  if (error) throw error;
  return data;
}

describe("submitCheckin", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("寫入一筆，記錄誰、何時", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");

    const { submitCheckin } = await import("@/server/actions/checkin");
    const before = new Date();
    const result = await submitCheckin({ light: "yellow", note: "" });
    const after = new Date();

    expect(result).toEqual({ ok: true });

    const rows = await checkinsFor(seed.lineB);
    // seedSemester() 已經幫第2組種過一筆綠燈 check-in，這裡新增的是第二筆。
    const mine = rows.filter((r) => r.created_by === "b1@g.nccu.edu.tw" && r.light === "yellow");
    expect(mine).toHaveLength(1);
    const at = new Date(mine[0].created_at as string).getTime();
    expect(at).toBeGreaterThanOrEqual(before.getTime());
    expect(at).toBeLessThanOrEqual(after.getTime());
  });

  it("幹部（非專案生）送出 → 被拒，收到『只有專案生可以點燈號』", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asOfficer(seed.semesterId);

    const { submitCheckin } = await import("@/server/actions/checkin");
    const result = await submitCheckin({ light: "green", note: "" });

    expect(result).toEqual({ ok: false, error: REJECTED });
    expect(await checkinsFor(seed.lineA)).toHaveLength(1); // 只有種子那一筆，沒有多寫
  });

  it("不在名單上的人送出 → 被拒，收到同一句錯誤", async () => {
    const seed = await seedSemester({ acknowledged: true });
    mockGetAccess.mockResolvedValue({ kind: "not_in_roster" });

    const { submitCheckin } = await import("@/server/actions/checkin");
    const result = await submitCheckin({ light: "green", note: "" });

    expect(result).toEqual({ ok: false, error: REJECTED });
    void seed;
  });

  it("紅燈沒補說明 → 伺服器端先擋下來，回『紅燈請補一句卡在哪裡』，不寫入任何列", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");

    const { submitCheckin } = await import("@/server/actions/checkin");
    const result = await submitCheckin({ light: "red", note: "   " });

    expect(result).toEqual({ ok: false, error: "紅燈請補一句卡在哪裡" });
    const rows = await checkinsFor(seed.lineB);
    // seedSemester() 已經幫第2組種過一筆（b1、綠燈），這裡要確認的是「沒有再多寫一筆紅燈」。
    expect(rows.filter((r) => r.created_by === "b1@g.nccu.edu.tw" && r.light === "red")).toHaveLength(0);
  });

  it("第2組學生點燈，只寫進第2組的線，不會混進第1組", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");

    const { submitCheckin } = await import("@/server/actions/checkin");
    const before = await checkinsFor(seed.lineA);
    const result = await submitCheckin({ light: "yellow", note: "" });

    expect(result).toEqual({ ok: true });
    expect(await checkinsFor(seed.lineA)).toEqual(before); // 第1組的線完全沒被動到
  });

  it("真實邊界：直接用 service client 插入紅燈＋空白說明，被資料庫 CHECK 擋下來", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const db = createServiceSupabase();
    const { error } = await db.from("checkins").insert({
      line_id: seed.lineA,
      light: "red",
      note: "   ",
      created_by: "a1@g.nccu.edu.tw",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514"); // check_violation
  });

  it("紅燈點燈成功後，loadMyGroup（以該學生身分）顯示紅燈、來源『組員回報』，latestReport 指向這筆", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("b1@g.nccu.edu.tw"));

    const { submitCheckin } = await import("@/server/actions/checkin");
    const before = new Date();
    const result = await submitCheckin({ light: "red", note: "卡在後端 API" });
    expect(result).toEqual({ ok: true });

    const { loadMyGroup } = await import("@/server/queries/my-group");
    const data = await loadMyGroup();

    expect(data.display).toEqual({ light: "red", source: "組員回報" });
    expect(data.latestReport).not.toBeNull();
    expect(data.latestReport?.light).toBe("red");
    expect(data.latestReport?.name).toBe("乙一");
    expect(data.latestReport!.at.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// 最終審查 M7：期別名稱全站統一成「第 N 期」（有空格）。看板（dashboard.ts）早就是這樣，
// 學生自己的組頁（my-group.ts）之前寫成「第N期」，同一個逾期在兩個畫面長得不一樣。
describe("loadMyGroup：系統判定燈的來源文字", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("第 1 期逾期 4 天沒交 → 來源「系統：第 1 期逾期 4 天」", async () => {
    const seed = await seedSemester({ acknowledged: true });
    await backdatePeriodDeadline(seed.periodIds[0], new Date(Date.now() - 4 * 24 * 3_600_000 - 60_000));
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("b1@g.nccu.edu.tw"));

    const { loadMyGroup } = await import("@/server/queries/my-group");
    const data = await loadMyGroup();
    expect(data.display).toEqual({ light: "red", source: "系統：第 1 期逾期 4 天" });
  });
});

// 最終審查 M6：點燈號也要求這學期按過「我已了解」。
describe("submitCheckin：還沒按「我已了解」", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("回傳「請先閱讀並同意使用說明」，不寫入", async () => {
    const seed = await seedSemester(); // 沒有 acknowledged
    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    const { submitCheckin } = await import("@/server/actions/checkin");
    const result = await submitCheckin({ light: "yellow", note: "" });
    expect(result).toEqual({ ok: false, error: "請先閱讀並同意使用說明" });

    const db = createServiceSupabase();
    const { count } = await db.from("checkins").select("id", { count: "exact", head: true }).eq("line_id", seed.lineB);
    expect(count).toBe(1); // 只有 seedSemester 種的那一筆
  });
});
