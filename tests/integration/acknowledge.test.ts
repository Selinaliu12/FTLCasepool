import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, okAccess } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

// acknowledge() 一律先呼叫 getAccess()，跟 admin-actions.test.ts 一樣用 vi.mock 假造
// @/server/session，讓每個測試自己決定「呼叫者是誰」，不用真的登入。acknowledge() 成功時
// 會呼叫 next/navigation 的 redirect("/")；測試環境裡沒有 request context，redirect() 真的執行
// 會丟例外，所以也一併假造成不做事的函式。
const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

function asStudent(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "m1", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId: "g1" },
    semesterId,
  }));
}

function asWrongDomain() {
  mockGetAccess.mockResolvedValue({ kind: "wrong_domain" });
}

describe("acknowledge", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("寫入的紀錄包含 email 與時間", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { acknowledge } = await import("@/server/actions/acknowledge");
    await acknowledge();

    const svc = createServiceSupabase();
    const { data } = await svc
      .from("acknowledgements")
      .select("email, acknowledged_at")
      .eq("semester_id", seed.semesterId);
    expect(data).toHaveLength(1);
    expect(data![0].email).toBe("a1@g.nccu.edu.tw");
    expect(data![0].acknowledged_at).not.toBeNull();
  });

  it("同一學期按兩次，只留一筆、acknowledged_at 不變", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { acknowledge } = await import("@/server/actions/acknowledge");
    await acknowledge();

    const svc = createServiceSupabase();
    const { data: first } = await svc
      .from("acknowledgements")
      .select("acknowledged_at")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw")
      .single();

    // 等待超過一秒：如果實作其實是「更新」而不是「重複就忽略」，acknowledged_at 一定會變。
    await new Promise((r) => setTimeout(r, 1100));
    await acknowledge();

    const { data: rows } = await svc
      .from("acknowledgements")
      .select("acknowledged_at")
      .eq("semester_id", seed.semesterId)
      .eq("email", "a1@g.nccu.edu.tw");
    expect(rows).toHaveLength(1);
    expect(rows![0].acknowledged_at).toBe(first!.acknowledged_at);
  });

  it("新學期要重新按：hasAcknowledged 對新學期回傳 false", async () => {
    const seed = await seedSemester();
    asStudent(seed.semesterId);
    const { acknowledge } = await import("@/server/actions/acknowledge");
    const { hasAcknowledged } = await import("@/server/queries/acknowledgement");
    await acknowledge();
    expect(await hasAcknowledged(seed.semesterId, "a1@g.nccu.edu.tw")).toBe(true);

    const svc = createServiceSupabase();
    const { data: newSem } = await svc.from("semesters").insert({ name: "115-2" }).select("id").single();
    expect(await hasAcknowledged(newSem!.id, "a1@g.nccu.edu.tw")).toBe(false);
  });

  // 最終審查 M5：hasAcknowledged 放在 "use server" 檔案裡，會被 Next 當成任何人都能從瀏覽器
  // 呼叫的 server action（可以拿任意 semesterId／email 去探測誰按過）。搬到 server-only 的 queries。
  it("hasAcknowledged 不是 server action（不從 \"use server\" 檔案匯出）", async () => {
    const actions = await import("@/server/actions/acknowledge");
    expect(Object.keys(actions)).toEqual(["acknowledge"]);
  });

  it("kind 不是 ok 就丟錯，不寫入", async () => {
    const seed = await seedSemester();
    asWrongDomain();
    const { acknowledge } = await import("@/server/actions/acknowledge");
    await expect(acknowledge()).rejects.toThrow();

    const svc = createServiceSupabase();
    const { count } = await svc
      .from("acknowledgements")
      .select("email", { count: "exact", head: true })
      .eq("semester_id", seed.semesterId);
    expect(count).toBe(0);
  });
});
