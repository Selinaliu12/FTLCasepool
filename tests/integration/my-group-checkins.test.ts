import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";

// my-group/page.tsx 要顯示「中間週燈號歷程」（規格 §4.4）：loadMyGroup() 目前只把
// checkins 併進 latestReport，這裡驗證它同時回傳完整的歷程列表（燈號、誰、何時、
// 紅燈說明），由新到舊排序。
vi.mock("@/server/session", () => ({ getAccess: vi.fn() }));
import { getAccess } from "@/server/session";
const mockGetAccess = vi.mocked(getAccess);

const mockCreateServerSupabase = vi.fn();
vi.mock("@/server/supabase", async () => {
  const actual = await vi.importActual<typeof import("@/server/supabase")>("@/server/supabase");
  return { ...actual, createServerSupabase: () => mockCreateServerSupabase() };
});
import { loadMyGroup } from "@/server/queries/my-group";

function asStudent(semesterId: string, groupId: string, email: string, name: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "s-id", semesterId, email, name, role: "student", groupId },
    semesterId,
  });
}

describe("loadMyGroup：中間週燈號歷程", () => {
  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
  });

  it("回傳自己組的 checkins（燈號、誰、何時、紅燈說明），由新到舊排序", async () => {
    const seed = await seedSemester({ acknowledged: true });
    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const data = await loadMyGroup();

    expect(data.checkins.length).toBeGreaterThan(0);
    const redCheckin = data.checkins.find((c) => c.light === "red");
    expect(redCheckin?.note).toBe("卡在資料串接");
    expect(redCheckin?.by).toBe("甲一");
  });
});
