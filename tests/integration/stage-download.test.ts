import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs, asPm, asOfficer, asStudent, asAdminNoMember } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// getStagePdfDownloadUrl 跟 getPdfDownloadUrl（download.test.ts）同一套模式：使用者身分連線
// 讀 stage_submissions（RLS can_read_content 擋掉其他幹部與別組），通過才簽 GET 網址；
// 管理員（沒有 member 列）走服務身分。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});
import { getStagePdfDownloadUrl } from "@/server/actions/download";

// Final review minor 10：跟 stages.ts 的階段動作一致，用「找不到這筆繳交」。
const NOT_FOUND = "找不到這筆繳交";

async function createCompetition(semesterId: string) {
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

async function insertSubmission(lineId: string, groupId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("stage_submissions")
    .insert({
      line_id: lineId,
      stage: "signup",
      version: 1,
      pdf_key: `115-1/${groupId}/signup-v1.pdf`,
      pdf_size: 1024,
      pdf_uploaded_at: new Date().toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
      submitted_by: "a1@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

describe("getStagePdfDownloadUrl", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let submissionId: string;

  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
    seed = await seedSemester();
    const competition = await createCompetition(seed.semesterId);
    const { lineId } = await confirmedEntry(seed.groupA, competition.id);
    const submission = await insertSubmission(lineId, seed.groupA);
    submissionId = submission.id as string;
  });

  it("學生讀自己組的繳交 ok，別組被拒", async () => {
    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    const own = await getStagePdfDownloadUrl(submissionId);
    expect(own.ok).toBe(true);

    asStudent(mockGetAccess, seed.semesterId, seed.groupB, "b1@g.nccu.edu.tw", "乙一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("b1@g.nccu.edu.tw"));
    const other = await getStagePdfDownloadUrl(submissionId);
    expect(other).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("其他幹部被拒", async () => {
    asOfficer(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));
    const result = await getStagePdfDownloadUrl(submissionId);
    expect(result).toEqual({ ok: false, error: NOT_FOUND });
  });

  it("專案幹部 ok，網址是預簽 GET、10 分鐘有效、帶正確下載檔名", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    const result = await getStagePdfDownloadUrl(submissionId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const url = new URL(result.url);
      const disposition = url.searchParams.get("response-content-disposition");
      expect(disposition).toContain(encodeURIComponent("115-1-第1組-黑客松-報名-v1.pdf"));
      expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    }
  });

  it("管理員（服務身分）ok", async () => {
    asAdminNoMember(mockGetAccess, seed.semesterId);
    const result = await getStagePdfDownloadUrl(submissionId);
    expect(result.ok).toBe(true);
  });

  // Final review IMPORTANT 1c：比賽那一列讀不到（例如被改成草稿，學生的 RLS 擋掉）時，
  // 以前 .single() 直接丟 PGRST116 例外（前端只看到「下載失敗」）；現在跟其他看不到的情況一樣
  // 回統一的找不到。
  it("比賽讀不到（草稿被 RLS 擋掉）時回統一的找不到，不丟例外", async () => {
    const db = createServiceSupabase();
    const { error } = await db.from("competitions").update({ status: "draft" }).neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw error;

    asStudent(mockGetAccess, seed.semesterId, seed.groupA);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));
    await expect(getStagePdfDownloadUrl(submissionId)).resolves.toEqual({ ok: false, error: NOT_FOUND });
  });

  it("亂填 id 與不存在的 UUID 都回統一的找不到這筆繳交", async () => {
    asPm(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("pm@g.nccu.edu.tw"));
    expect(await getStagePdfDownloadUrl("abc")).toEqual({ ok: false, error: NOT_FOUND });
    expect(await getStagePdfDownloadUrl("00000000-0000-0000-0000-000000000000")).toEqual({
      ok: false,
      error: NOT_FOUND,
    });
  });
});
