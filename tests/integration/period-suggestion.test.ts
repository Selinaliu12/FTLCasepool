import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetDb, seedSemester, clientAs, okAccess } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// Batch 2 Task 1：loadMyGroup() 每期要帶出管理員填的「建議繳交內容」（periods.suggestion），
// 沒填的期別回傳 null，前端據此決定要不要顯示「本期建議繳交：…」。
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
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email,
    isAdmin: false,
    member: { id: "s-id", semesterId, email, name, role: "student", groupId },
    semesterId,
  }));
}

describe("loadMyGroup：每期建議繳交內容", () => {
  beforeEach(async () => {
    mockCreateServerSupabase.mockReset();
    await resetDb();
  });

  it("回傳每期的 suggestion；沒填的期別是 null", async () => {
    const seed = await seedSemester();
    const svc = createServiceSupabase();
    const { error } = await svc.from("periods").update({ suggestion: "這期建議交截圖" }).eq("id", seed.periodIds[0]);
    expect(error).toBeNull();

    asStudent(seed.semesterId, seed.groupA, "a1@g.nccu.edu.tw", "甲一");
    mockCreateServerSupabase.mockResolvedValue(await clientAs("a1@g.nccu.edu.tw"));

    const data = await loadMyGroup();

    const p1 = data.periods.find((p) => p.periodId === seed.periodIds[0]);
    const p2 = data.periods.find((p) => p.periodId === seed.periodIds[1]);
    expect(p1?.suggestion).toBe("這期建議交截圖");
    expect(p2?.suggestion).toBeNull();
  });
});
