import { beforeEach, describe, it, expect, vi } from "vitest";
import { resetDb, seedSemester, okAccess } from "./helpers";
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
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "pm@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "pm-id", semesterId, email: "pm@g.nccu.edu.tw", name: "專案幹部", role: "pm", groupId: null },
    semesterId,
  }));
}

function asOfficer(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "off@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "off-id", semesterId, email: "off@g.nccu.edu.tw", name: "其他幹部", role: "officer", groupId: null },
    semesterId,
  }));
}

function asAdmin(semesterId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "admin@g.nccu.edu.tw",
    isAdmin: true,
    member: null,
    semesterId,
  }));
}

function asStudent(semesterId: string, groupId: string) {
  mockGetAccess.mockResolvedValue(okAccess({
    kind: "ok",
    email: "a1@g.nccu.edu.tw",
    isAdmin: false,
    member: { id: "s-id", semesterId, email: "a1@g.nccu.edu.tw", name: "甲一", role: "student", groupId },
    semesterId,
  }));
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

  // Minor 1（controller ruling，fix round 1）：signupTime 沒填（undefined／空字串）時，時間
  // 預設 23:59，沿用 parseTaipeiDeadline 補成 23:59:59.999（台北時區），對應存進資料庫的
  // UTC 時間是同一天 15:59:59.999Z。
  it("signupTime 留空，存進去的 signup_deadline 是台北時間 23:59:59.999", async () => {
    asPm(seed.semesterId);
    const result = await createCompetition({ ...validForm, signupDate: "2026-12-01", signupTime: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("signup_deadline").eq("id", result.id).single();
    expect(new Date(data!.signup_deadline as string).toISOString()).toBe("2026-12-01T15:59:59.999Z");
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

  // Minor 1（controller ruling，fix round 1）：id 格式正確、確實存在，但屬於別的學期——不能因為
  // 呼叫者是本學期的幹部就讓他改到別學期的資料。findOwnCompetition 用
  // `.eq("semester_id", access.semesterId)` 擋掉，跟「id 根本不存在」回傳同一個錯誤，不透露
  // 「這個 id 其實存在，只是不是你的學期」。
  it("id 存在但屬於別的學期，回傳找不到這場比賽", async () => {
    const service = createServiceSupabase();
    const { data: otherSemester, error: otherSemesterError } = await service
      .from("semesters")
      .insert({ name: "別的學期", is_current: false })
      .select()
      .single();
    if (otherSemesterError) throw otherSemesterError;

    const { data: otherComp, error: otherCompError } = await service
      .from("competitions")
      .insert({
        semester_id: otherSemester.id,
        name: "別學期的比賽",
        url: "https://example.com/other-semester",
        signup_deadline: "2026-12-01T15:59:59.999Z",
        status: "draft",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (otherCompError) throw otherCompError;

    asPm(seed.semesterId);
    await expect(updateCompetition(otherComp.id as string, validForm)).rejects.toThrow("找不到這場比賽");
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
    expect(await unpublishCompetition(competitionId)).toEqual({ ok: true });
    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("status").eq("id", competitionId).single();
    expect(data!.status).toBe("draft");
  });

  it("學生呼叫發布被拒", async () => {
    asStudent(seed.semesterId, seed.groupA);
    await expect(publishCompetition(competitionId)).rejects.toThrow("只有幹部可以編輯競賽");
  });

  // Final review IMPORTANT 1（controller ruling a）：已經有組別掛了（未退出）的比賽不能取消發布
  // ——草稿會被 read_competitions 的 RLS 擋掉，學生那邊的報名頁／比賽線／下載全部讀不到比賽。
  it("已經有組別報名（未退出）時拒絕取消發布，狀態維持 published", async () => {
    await publishCompetition(competitionId);
    const db = createServiceSupabase();
    const { error: entryError } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" });
    if (entryError) throw entryError;

    const result = await unpublishCompetition(competitionId);
    expect(result).toEqual({ ok: false, error: "已經有組別報名這場比賽，不能取消發布" });

    const { data } = await db.from("competitions").select("status").eq("id", competitionId).single();
    expect(data!.status).toBe("published");
  });

  it("報名都已退出時可以取消發布", async () => {
    await publishCompetition(competitionId);
    const db = createServiceSupabase();
    const { error: entryError } = await db.from("competition_entries").insert({
      group_id: seed.groupA,
      competition_id: competitionId,
      created_by: "a1@g.nccu.edu.tw",
      withdrawn_at: new Date().toISOString(),
    });
    if (entryError) throw entryError;

    const result = await unpublishCompetition(competitionId);
    expect(result).toEqual({ ok: true });
    const { data } = await db.from("competitions").select("status").eq("id", competitionId).single();
    expect(data!.status).toBe("draft");
  });

  // 另一個方向的時間窗：attachCompetition 讀到 published 之後、insert 之前，比賽剛好被取消發布
  // ——資料庫的 trigger 在 insert 時用 FOR SHARE 鎖住比賽那一列再看一次 status，草稿一律拒絕。
  it("資料庫層：草稿比賽不能被新掛上（未退出）報名", async () => {
    const db = createServiceSupabase();
    const { error } = await db
      .from("competition_entries")
      .insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" });
    expect(error?.message).toBe("competition_not_published");
  });

  it("有報名時跟 attach 併發取消發布，最後不會出現「草稿＋未退出報名」", async () => {
    await publishCompetition(competitionId);
    const db = createServiceSupabase();
    const [insertRes, unpublishRes] = await Promise.all([
      db.from("competition_entries").insert({ group_id: seed.groupA, competition_id: competitionId, created_by: "a1@g.nccu.edu.tw" }),
      unpublishCompetition(competitionId),
    ]);
    const { data: comp } = await db.from("competitions").select("status").eq("id", competitionId).single();
    const { data: active } = await db
      .from("competition_entries")
      .select("id")
      .eq("competition_id", competitionId)
      .is("withdrawn_at", null);
    if (comp!.status === "draft") {
      expect(unpublishOk(unpublishRes)).toBe(true);
      expect(insertRes.error).not.toBeNull();
      expect(active).toEqual([]);
    } else {
      expect(insertRes.error).toBeNull();
      expect(active).toHaveLength(1);
    }
  });
});

function unpublishOk(r: { ok: boolean }): boolean {
  return r.ok;
}

// Task 1（競賽大廳新模板）：新欄位的建立／讀回／清空／DB 層擋掉不合法標籤。
describe("competitions：新欄位（Task 1）", () => {
  let seed: Awaited<ReturnType<typeof seedSemester>>;

  beforeEach(async () => {
    mockGetAccess.mockReset();
    await resetDb();
    seed = await seedSemester();
  });

  const fullForm = {
    ...validForm,
    summary: "一句話介紹",
    tags: ["ESG", "創業", "ESG"], // 重複標籤：存進去要去重並依清單排序
    maxPrize: "500000",
    perks: "有機會被創投看到",
    infoSessionDate: "2026-11-01",
    infoSessionTime: "19:00",
    signupNote: "報名成功證明 PDF",
    submissionNote: "送出的作品 PDF",
    finalNote: "決賽簡報 PDF",
    finalFormat: "線上 Google Meet",
    fee: "免費",
    documents: "身分證正反面",
    skills: "簡報、財務分析",
    recommended: true,
    staffNote: "很適合新手隊伍",
  };

  it("幹部建立含全部新欄位的比賽，讀回來值相同", async () => {
    asPm(seed.semesterId);
    const result = await createCompetition(fullForm);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const db = createServiceSupabase();
    const { data } = await db
      .from("competitions")
      .select(
        "summary, tags, max_prize, perks, info_session_at, signup_note, submission_note, final_note, final_format, fee, documents, skills, recommended, staff_note"
      )
      .eq("id", result.id)
      .single();

    expect(data!.summary).toBe("一句話介紹");
    expect(data!.tags).toEqual(["創業", "ESG"]); // 依 COMPETITION_TAGS 清單排序：創業在 ESG 前面
    expect(data!.max_prize).toBe(500000);
    expect(data!.perks).toBe("有機會被創投看到");
    expect(new Date(data!.info_session_at as string).toISOString()).toBe("2026-11-01T11:00:59.999Z");
    expect(data!.signup_note).toBe("報名成功證明 PDF");
    expect(data!.submission_note).toBe("送出的作品 PDF");
    expect(data!.final_note).toBe("決賽簡報 PDF");
    expect(data!.final_format).toBe("線上 Google Meet");
    expect(data!.fee).toBe("免費");
    expect(data!.documents).toBe("身分證正反面");
    expect(data!.skills).toBe("簡報、財務分析");
    expect(data!.recommended).toBe(true);
    expect(data!.staff_note).toBe("很適合新手隊伍");
  });

  it("更新時把欄位清空會存成 null", async () => {
    asPm(seed.semesterId);
    const created = await createCompetition(fullForm);
    if (!created.ok) throw new Error("setup failed");

    const cleared = await updateCompetition(created.id, {
      ...validForm,
      summary: "",
      tags: [],
      maxPrize: "",
      perks: "  ",
      infoSessionDate: "",
      signupNote: "",
      submissionNote: "",
      finalNote: "",
      finalFormat: "",
      fee: "",
      documents: "",
      skills: "",
      recommended: false,
      staffNote: "",
    });
    expect(cleared.ok).toBe(true);

    const db = createServiceSupabase();
    const { data } = await db
      .from("competitions")
      .select(
        "summary, tags, max_prize, perks, info_session_at, signup_note, submission_note, final_note, final_format, fee, documents, skills, recommended, staff_note"
      )
      .eq("id", created.id)
      .single();

    expect(data!.summary).toBeNull();
    expect(data!.tags).toEqual([]);
    expect(data!.max_prize).toBeNull();
    expect(data!.perks).toBeNull();
    expect(data!.info_session_at).toBeNull();
    expect(data!.signup_note).toBeNull();
    expect(data!.submission_note).toBeNull();
    expect(data!.final_note).toBeNull();
    expect(data!.final_format).toBeNull();
    expect(data!.fee).toBeNull();
    expect(data!.documents).toBeNull();
    expect(data!.skills).toBeNull();
    expect(data!.recommended).toBe(false);
    expect(data!.staff_note).toBeNull();
  });

  it("學生呼叫 createCompetition 仍被拒（沿用）", async () => {
    asStudent(seed.semesterId, seed.groupA);
    await expect(createCompetition(fullForm)).rejects.toThrow("只有幹部可以編輯競賽");
  });

  // Review Focus：tags 的 check constraint 要在 DB 層也擋，不能只靠應用層的 validateCompetition
  // ——用 service client 直接繞過應用層驗證 insert 一個不在清單內的標籤，資料庫要噴錯。
  it("DB 層：用 service client 直接 insert 不在清單內的標籤要被 check constraint 擋下來", async () => {
    const db = createServiceSupabase();
    const { error } = await db.from("competitions").insert({
      semester_id: seed.semesterId,
      name: "違規標籤比賽",
      url: "https://example.com/bad-tag",
      signup_deadline: "2026-12-01T15:59:59.999Z",
      tags: ["不存在的標籤"],
      status: "draft",
      created_by: "pm@g.nccu.edu.tw",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/competitions_tags_valid|check constraint/i);

    const { data } = await db.from("competitions").select("id").eq("url", "https://example.com/bad-tag");
    expect(data).toEqual([]);
  });

  it("DB 層：最高獎金超出範圍（負數）一樣被 check constraint 擋下來", async () => {
    const db = createServiceSupabase();
    const { error } = await db.from("competitions").insert({
      semester_id: seed.semesterId,
      name: "違規獎金比賽",
      url: "https://example.com/bad-prize",
      signup_deadline: "2026-12-01T15:59:59.999Z",
      max_prize: -1,
      status: "draft",
      created_by: "pm@g.nccu.edu.tw",
    });
    expect(error).not.toBeNull();
  });

  // 說明會日期時間跟其他三個日期欄位共用同一個 parseField，但目前沒有任何測試走過它回傳
  // error 的分支——只填了日期、時間格式亂填，回傳欄位錯誤 key 是 infoSessionAt，不寫入資料庫。
  it("說明會時間格式錯誤（parseField 的 error 分支）→ infoSessionAt 欄位錯誤，不寫入資料庫", async () => {
    asPm(seed.semesterId);
    const result = await createCompetition({
      ...validForm,
      infoSessionDate: "2026-11-01",
      infoSessionTime: "不是時間",
    });
    expect(result).toEqual({ ok: false, errors: { infoSessionAt: "日期或時間格式錯誤" } });

    const db = createServiceSupabase();
    const { data } = await db.from("competitions").select("id").eq("semester_id", seed.semesterId);
    expect(data).toEqual([]);
  });
});
