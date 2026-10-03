import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/server/env";
import { resetDb, seedSemester, service, clientAs, queryAsForgedJwt, asAdminNoMember, asOfficer } from "./helpers";

// 狀態視圖 line_light_events／stage_status 是 security_invoker = false，WHERE 用
// can_read_status() 判斷——那個函式只看 auth.jwt() 裡的會員信箱。管理員看板走 service client
// （service_role 的 JWT 沒有信箱），修正前兩個視圖對它一律回 0 列，看板上每一組的雙週報告、
// 比賽階段繳交都像沒交。這裡釘住：service_role 讀得到、管理員看板跟其他幹部看到的一樣；
// anon、不在名單上的登入者、以及只在 JWT claim 裡自稱 service_role 的 authenticated 連線
// 仍然一列都讀不到。
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

let seed: Awaited<ReturnType<typeof seedSemester>>;
let competitionLineId: string;

// 第2組報名一個比賽、報名階段已通過，讓 stage_status 有一列可讀（通過才會把比賽線推到「已報名」）。
async function seedStageSubmission(): Promise<string> {
  const db = service();
  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "黑客松",
      url: "https://example.com",
      signup_deadline: "2026-09-27T15:59:59.999Z",
      submission_deadline: "2026-10-20T15:59:59.999Z",
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
    pdf_uploaded_at: new Date("2026-09-20T00:00:00Z").toISOString(),
    pdf_uploaded_by: "b1@g.nccu.edu.tw",
    submitted_by: "b1@g.nccu.edu.tw",
    review_status: "approved",
    reviewed_by: "pm@g.nccu.edu.tw",
    reviewed_at: new Date("2026-09-21T00:00:00Z").toISOString(),
  });
  if (subError) throw subError;
  return line.id as string;
}

beforeEach(async () => {
  mockCreateServerSupabase.mockReset();
  await resetDb();
  seed = await seedSemester();
  competitionLineId = await seedStageSubmission();
});

describe("狀態視圖：service_role 讀得到", () => {
  it("line_light_events 回傳種子的雙週報告與期中點燈", async () => {
    const { data, error } = await service().from("line_light_events").select("line_id, light, period_id");
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows).toHaveLength(3); // 第1組：1 份報告 + 1 筆點燈；第2組：1 筆點燈
    expect(rows.filter((r) => r.period_id === seed.periodIds[0])).toEqual([
      { line_id: seed.lineA, light: "green", period_id: seed.periodIds[0] },
    ]);
  });

  it("stage_status 回傳種子的階段繳交", async () => {
    const { data, error } = await service().from("stage_status").select("line_id, stage, version");
    expect(error).toBeNull();
    expect(data).toEqual([{ line_id: competitionLineId, stage: "signup", version: 1 }]);
  });
});

describe("管理員看板（service client）", () => {
  it("跟其他幹部看到的燈號、來源、準時率、比賽階段完全一樣", async () => {
    const now = new Date("2026-10-05T00:00:00Z");

    asOfficer(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockResolvedValue(await clientAs("off@g.nccu.edu.tw"));
    const officerView = await loadDashboard(now);

    asAdminNoMember(mockGetAccess, seed.semesterId);
    mockCreateServerSupabase.mockRejectedValue(new Error("user client must not be used for admin"));
    const adminView = await loadDashboard(now);

    expect(adminView.cards).toEqual(officerView.cards);

    // 不只是「兩邊一樣」：第1組第 1 期有交（準時率不是 null），第2組比賽線的報名階段已通過
    // （狀態是「已報名」）——修正前管理員這兩個都會像沒交。
    const groupA = adminView.cards.find((c) => c.groupName === "第1組")!;
    expect(groupA.lines[0].onTime).not.toBeNull();
    const groupB = adminView.cards.find((c) => c.groupName === "第2組")!;
    const competitionLine = groupB.lines.find((l) => l.kind === "competition")!;
    expect(competitionLine.status).toBe("已報名");
  });
});

describe("狀態視圖：非成員仍然讀不到", () => {
  it("anon 讀不到兩個視圖", async () => {
    const anon = createClient(env.supabaseUrl, env.supabaseAnonKey);
    const events = await anon.from("line_light_events").select("line_id");
    expect(events.error).not.toBeNull();
    const status = await anon.from("stage_status").select("line_id");
    expect(status.error).not.toBeNull();
  });

  it("不在名單上的登入者兩個視圖都是 0 列", async () => {
    const db = await clientAs("stranger@g.nccu.edu.tw");
    const events = await db.from("line_light_events").select("line_id");
    expect(events.error).toBeNull();
    expect(events.data).toEqual([]);
    const status = await db.from("stage_status").select("line_id");
    expect(status.error).toBeNull();
    expect(status.data).toEqual([]);
  });

  it("authenticated 連線只在 JWT claim 自稱 service_role 也讀不到（看的是資料庫角色，不是 claim）", async () => {
    const claims = { role: "service_role", email: "stranger@g.nccu.edu.tw", app_metadata: { provider: "google" } };
    expect(await queryAsForgedJwt(claims, "select line_id from line_light_events")).toEqual([]);
    expect(await queryAsForgedJwt(claims, "select line_id from stage_status")).toEqual([]);
  });
});
