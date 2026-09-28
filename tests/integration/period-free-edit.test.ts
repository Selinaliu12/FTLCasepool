import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resetDb,
  seedSemester,
  asUser,
  backdatePdfUploadedAt,
  asAdminNoMember,
  asOfficer,
  clientAs,
  withRawPg,
} from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// Adjustments Task 5（規格 §14 第 8 點）：管理員自由修改／刪除期別。這個檔案測三件事：
//   1. 改已交件期別的截止日 → 準時率跟著新日期重算（沒有存「準時與否」這種衍生欄位）。
//   2. 刪除期別後 R2 物件刪除失敗：記 log、動作仍回成功（孤兒檔案由批次 3 的清掃處理）。
//   3. 鎖定觸發器的放行旗標（app.allow_admin_period_delete）不會變成一般使用者的後門：
//      authenticated 自己設了旗標也刪不掉鎖定的進度；save_periods 用完就關掉；學生撤回鎖定的
//      進度仍被拒（Review Focus 4）。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockDeleteObject = vi.fn();
vi.mock("@/server/r2", () => ({
  inspectUploaded: vi.fn(),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});

const LOCKED_ERROR = "已超過 2 小時，已鎖定不能修改";
const THREE_HOURS_AGO = () => new Date(Date.now() - 3 * 60 * 60 * 1000);

async function reportOf(lineId: string, periodId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("progress_reports")
    .select("id, pdf_key")
    .eq("line_id", lineId)
    .eq("period_id", periodId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; pdf_key: string } | null;
}

// 在第 2 期替第1組多交一份進度（seed 只有第 1 期有交），用來當「不在被刪期別裡的鎖定進度」。
async function addReportOnPeriod2(lineId: string, periodId: string): Promise<string> {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("progress_reports")
    .insert({
      line_id: lineId,
      period_id: periodId,
      light: "green",
      did: "第二期內容",
      blocked: "無",
      next_steps: "繼續",
      submitted_by: "a1@g.nccu.edu.tw",
      pdf_key: "reports/lineA/period2.pdf",
      pdf_size: 1024,
      pdf_uploaded_at: new Date().toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("管理員自由修改／刪除期別", () => {
  beforeEach(async () => {
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  it("把已交件期別的截止日改到交件時間之前 → 看板上的準時率從 0.5 變成 0", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const report = await reportOf(seed.lineA, seed.periodIds[0]);
    // 第1組在台北 9/20 交了第 1 期（截止 10/01），第 2 期（11/01）沒交。
    await backdatePdfUploadedAt(report!.id, new Date("2026-09-20T04:00:00Z"));
    const now = new Date("2026-12-01T00:00:00Z");

    asOfficer(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));
    const { loadDashboard } = await import("@/server/queries/dashboard");
    const before = await loadDashboard(now);
    const cardBefore = before.cards.find((c) => c.groupId === seed.groupA)!;
    expect(cardBefore.lines[0].onTime).toBe(0.5);

    asAdminNoMember(mockGetAccess, seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [
      { id: seed.periodIds[0], date: "2026-09-15", time: "23:59" },
      { id: seed.periodIds[1], date: "2026-11-01", time: "08:00" },
    ]);
    expect(r).toEqual({ ok: true });

    asOfficer(mockGetAccess, seed.semesterId);
    const after = await loadDashboard(now);
    const cardAfter = after.cards.find((c) => c.groupId === seed.groupA)!;
    expect(cardAfter.lines[0].onTime).toBe(0);
  });

  it("確認刪除後 R2 刪檔失敗：記錄錯誤、動作仍回成功，資料庫裡的進度已經刪掉", async () => {
    const seed = await seedSemester();
    const report = await reportOf(seed.lineA, seed.periodIds[0]);
    mockDeleteObject.mockRejectedValue(new Error("R2 down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    asAdminNoMember(mockGetAccess, seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }], {
      confirmDeleteWithReports: true,
      expectedReportCounts: { [seed.periodIds[0]]: 1 },
    });

    expect(r).toEqual({ ok: true });
    expect(mockDeleteObject).toHaveBeenCalledWith(report!.pdf_key);
    expect(consoleError).toHaveBeenCalled();
    expect(await reportOf(seed.lineA, seed.periodIds[0])).toBeNull();
    consoleError.mockRestore();
  });

  it("沒確認就刪除有人交件的期別：R2 物件完全沒被碰", async () => {
    const seed = await seedSemester();
    asAdminNoMember(mockGetAccess, seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }]);
    expect(r).toEqual({ ok: false, errors: ["這期已經有組別交了進度，要刪除請先確認"] });
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });
});

describe("鎖定觸發器的放行旗標不是一般使用者的後門", () => {
  beforeEach(async () => {
    mockDeleteObject.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    await resetDb();
  });

  it("authenticated 使用者用 API 直接刪除鎖定的進度 → 被拒，進度還在", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const report = await reportOf(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(report!.id, THREE_HOURS_AGO());

    const client = await clientAs("a1@g.nccu.edu.tw");
    const { error } = await client.from("progress_reports").delete().eq("id", report!.id);
    expect(error).not.toBeNull();
    expect(await reportOf(seed.lineA, seed.periodIds[0])).not.toBeNull();
  });

  it("authenticated 角色自己設了 app.allow_admin_period_delete = on，仍刪不掉鎖定的進度", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const report = await reportOf(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(report!.id, THREE_HOURS_AGO());

    const message = await withRawPg(async (client) => {
      await client.query("begin");
      try {
        await client.query("set local role authenticated");
        await client.query("select set_config('app.allow_admin_period_delete', 'on', true)");
        await client.query("delete from progress_reports where id = $1", [report!.id]);
        return "deleted";
      } catch (e) {
        return (e as Error).message;
      } finally {
        await client.query("rollback");
      }
    });
    expect(message).toMatch(/permission denied/);
    expect(await reportOf(seed.lineA, seed.periodIds[0])).not.toBeNull();
  });

  it("沒有旗標時，連 service_role 直接刪除鎖定的進度都被 LOCKED 擋下", async () => {
    const seed = await seedSemester();
    const report = await reportOf(seed.lineA, seed.periodIds[0]);
    await backdatePdfUploadedAt(report!.id, THREE_HOURS_AGO());
    const { error } = await createServiceSupabase().from("progress_reports").delete().eq("id", report!.id);
    expect(error?.message).toContain("LOCKED");
  });

  it("save_periods 刪完期別就關掉旗標：同一個交易裡再刪別期的鎖定進度仍被 LOCKED 擋下", async () => {
    const seed = await seedSemester();
    const otherId = await addReportOnPeriod2(seed.lineA, seed.periodIds[1]);
    await backdatePdfUploadedAt(otherId, THREE_HOURS_AGO());

    const message = await withRawPg(async (client) => {
      await client.query("begin");
      try {
        await client.query("select save_periods($1, $2::jsonb, true, $3::jsonb)", [
          seed.semesterId,
          JSON.stringify([{ id: seed.periodIds[1], deadline: "2026-11-01T00:00:00Z", suggestion: null }]),
          JSON.stringify({ [seed.periodIds[0]]: 1 }),
        ]);
        await client.query("delete from progress_reports where id = $1", [otherId]);
        return "deleted";
      } catch (e) {
        return (e as Error).message;
      } finally {
        await client.query("rollback");
      }
    });
    expect(message).toContain("LOCKED");
  });

  it("管理員刪除過期別之後，學生撤回別期已鎖定的進度仍被拒（Review Focus 4）", async () => {
    const seed = await seedSemester({ acknowledged: true });
    const otherId = await addReportOnPeriod2(seed.lineA, seed.periodIds[1]);
    await backdatePdfUploadedAt(otherId, THREE_HOURS_AGO());

    asAdminNoMember(mockGetAccess, seed.semesterId);
    const { savePeriods } = await import("@/server/actions/admin");
    const r = await savePeriods(seed.semesterId, [{ id: seed.periodIds[1], date: "2026-11-01", time: "08:00" }], {
      confirmDeleteWithReports: true,
      expectedReportCounts: { [seed.periodIds[0]]: 1 },
    });
    expect(r).toEqual({ ok: true });

    const { withdrawProgress } = await import("@/server/actions/progress");
    const result = await asUser("a1@g.nccu.edu.tw", () => withdrawProgress(otherId));
    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });
    expect(await reportOf(seed.lineA, seed.periodIds[1])).not.toBeNull();
  });
});
