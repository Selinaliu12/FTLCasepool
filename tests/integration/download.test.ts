import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// getPdfDownloadUrl 先用使用者身分連線讀那筆 progress_reports（RLS 的 can_read_content 擋掉
// 其他幹部與別組），通過才簽 GET 網址；管理員（沒有 member 列）才走服務身分。跟
// group-detail.test.ts 一樣用 vi.mock 假造 @/server/session，把 createServerSupabase()
// 換成 clientAs() 簽出來的真實登入 client。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});
import { getPdfDownloadUrl } from "@/server/actions/download";

function asPm(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "pm@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "pm-id", semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  });
}

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "off-id", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  });
}

function asStudent(semesterId: string, groupId: string, email = "a1@g.nccu.edu.tw", name = "甲一") {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "s-id", semesterId, email, name, role: "student", groupId },
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

async function reportIdForPeriod1(lineId: string): Promise<string> {
  const db = createServiceSupabase();
  const { data, error } = await db.from("progress_reports").select("id").eq("line_id", lineId).single();
  if (error) throw error;
  return data.id as string;
}

describe("getPdfDownloadUrl", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let reportId: string;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
    reportId = await reportIdForPeriod1(seed.lineA);
  });

  it("學生讀自己組的報告 ok，別組被拒", async () => {
    asStudent(seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const own = await getPdfDownloadUrl(reportId);
    expect(own.ok).toBe(true);

    asStudent(seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("b1@g.nccu.edu.tw"));
    const other = await getPdfDownloadUrl(reportId);
    expect(other).toEqual({ ok: false, error: "找不到這份進度" });
  });

  it("其他幹部被拒", async () => {
    asOfficer(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));
    const result = await getPdfDownloadUrl(reportId);
    expect(result).toEqual({ ok: false, error: "找不到這份進度" });
  });

  it("亂填 id 一律找不到這份進度", async () => {
    asPm(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const result = await getPdfDownloadUrl("00000000-0000-0000-0000-000000000000");
    expect(result).toEqual({ ok: false, error: "找不到這份進度" });
  });

  it("專案幹部 ok，網址是預簽 GET、帶正確下載檔名", async () => {
    asPm(seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const result = await getPdfDownloadUrl(reportId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.url);
      const disposition = url.searchParams.get("response-content-disposition");
      expect(disposition).toContain(encodeURIComponent("115-1-第1組-第1期.pdf"));
    }
  });

  it("管理員（沒有 member 列）ok", async () => {
    asAdminNoMember(seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin without member"));
    const result = await getPdfDownloadUrl(reportId);
    expect(result.ok).toBe(true);
  });
});
