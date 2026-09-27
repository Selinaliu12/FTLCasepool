import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester } from "./helpers";
import { createServiceSupabase } from "@/server/supabase";

const mockGetAccess = vi.fn();
vi.mock("@/server/session", () => ({ getAccess: () => mockGetAccess() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createCompetition,
  updateCompetition,
  publishCompetition,
  unpublishCompetition,
} from "@/server/actions/competitions";

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

function asAdmin(semesterId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  });
}

function asStudent(semesterId: string, groupId: string) {
  mockGetAccess.mockResolvedValue({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "s-id", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId },
    semesterId,
  });
}

const validForm = {
  name: "黑客松",
  url: "https://example.com",
  signupDate: "2026-12-01",
};

describe("createCompetition", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  it("專案幹部可以新增（存成草稿）", async () => {
    asPm(seed.semesterId);
    const result = await createCompetition(validForm);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("status, name, created_by").eq("id", result.id).single();
    expect(data!.status).toBe("draft");
    expect(data!.name).toBe("黑客松");
    expect(data!.created_by).toBe("pm@g.nccu.edu.tw");
  });

  it("其他幹部可以新增", async () => {
    asOfficer(seed.semesterId);
    const result = await createCompetition(validForm);
    expect(result.ok).toBe(true);
  });

  it("管理員可以新增", async () => {
    asAdmin(seed.semesterId);
    const result = await createCompetition(validForm);
    expect(result.ok).toBe(true);
  });

  it("學生呼叫被拒：只有幹部可以編輯競賽", async () => {
    asStudent(seed.semesterId, seed.groupA);
    await expect(createCompetition(validForm)).rejects.toThrow("只有幹部可以編輯競賽");
  });

  it("名稱空白回傳欄位錯誤，不寫入資料庫", async () => {
    asPm(seed.semesterId);
    const result = await createCompetition({ ...validForm, name: "  " });
    expect(result).toEqual({ ok: false, errors: { name: "請填比賽名稱" } });

    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("id").eq("semester_id", seed.semesterId);
    expect(data).toEqual([]);
  });

  it("非 http/https 網址（javascript: 協定）回傳欄位錯誤", async () => {
    asPm(seed.semesterId);
    const result = await createCompetition({ ...validForm, url: "javascript:alert(1)" });
    expect(result).toEqual({ ok: false, errors: { url: "請填正確的官方連結" } });
  });

  it("缺報名截止日回傳欄位錯誤", async () => {
    asPm(seed.semesterId);
    const result = await createCompetition({ ...validForm, signupDate: "" });
    expect(result).toEqual({ ok: false, errors: { signupDeadline: "請填報名截止日" } });
  });
});

describe("updateCompetition", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let competitionId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
    asPm(seed.semesterId);
    const created = await createCompetition(validForm);
    if (!created.ok) throw new Error("setup failed");
    competitionId = created.id;
  });

  it("幹部可以編輯已存在的競賽", async () => {
    asOfficer(seed.semesterId);
    const result = await updateCompetition(competitionId, { ...validForm, name: "改名黑客松" });
    expect(result.ok).toBe(true);

    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("name").eq("id", competitionId).single();
    expect(data!.name).toBe("改名黑客松");
  });

  it("學生呼叫被拒", async () => {
    asStudent(seed.semesterId, seed.groupA);
    await expect(updateCompetition(competitionId, validForm)).rejects.toThrow("只有幹部可以編輯競賽");
  });

  it("亂填 id 回傳找不到這場比賽", async () => {
    asPm(seed.semesterId);
    await expect(updateCompetition("not-a-uuid", validForm)).rejects.toThrow("找不到這場比賽");
  });

  it("格式正確但不存在的 id 回傳找不到這場比賽", async () => {
    asPm(seed.semesterId);
    await expect(updateCompetition("00000000-0000-0000-0000-000000000000", validForm)).rejects.toThrow(
      "找不到這場比賽"
    );
  });
});

describe("publishCompetition / unpublishCompetition", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;
  let competitionId: string;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
    asPm(seed.semesterId);
    const created = await createCompetition(validForm);
    if (!created.ok) throw new Error("setup failed");
    competitionId = created.id;
  });

  it("發布後狀態變成 published", async () => {
    await publishCompetition(competitionId);
    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("status").eq("id", competitionId).single();
    expect(data!.status).toBe("published");
  });

  it("取消發布後回到 draft", async () => {
    await publishCompetition(competitionId);
    await unpublishCompetition(competitionId);
    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("status").eq("id", competitionId).single();
    expect(data!.status).toBe("draft");
  });

  it("學生呼叫發布被拒", async () => {
    asStudent(seed.semesterId, seed.groupA);
    await expect(publishCompetition(competitionId)).rejects.toThrow("只有幹部可以編輯競賽");
  });
});
