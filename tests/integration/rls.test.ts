import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";

let seed: Awaited<ReturnType<typeof seedSemester>>;
beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();
});

describe("RLS：進度內容", () => {
  it("第2組學生讀不到第1組的三句話與 PDF", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data, error } = await db.from("progress_reports").select("did, pdf_key").eq("line_id", seed.lineA);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("第1組學生讀得到自己組的三句話", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("progress_reports").select("did, pdf_key").eq("line_id", seed.lineA);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("其他幹部讀不到任何組的三句話與紅燈說明，但從 line_light_events 讀得到各組燈號與時間", async () => {
    const db = await clientAs("off@g.nccu.edu.tw");
    const reports = await db.from("progress_reports").select("did").in("line_id", [seed.lineA, seed.lineB]);
    expect(reports.error).toBeNull();
    expect(reports.data).toEqual([]);
    const checkins = await db.from("checkins").select("note").eq("line_id", seed.lineA);
    expect(checkins.error).toBeNull();
    expect(checkins.data).toEqual([]);
    const events = await db.from("line_light_events").select("line_id, light").in("line_id", [seed.lineA, seed.lineB]);
    expect(events.error).toBeNull();
    const lineIds = new Set((events.data ?? []).map((e) => e.line_id));
    expect(lineIds.has(seed.lineA)).toBe(true);
    expect(lineIds.has(seed.lineB)).toBe(true);
  });

  it("專案幹部讀得到所有組的三句話", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const a = await db.from("progress_reports").select("did").eq("line_id", seed.lineA);
    expect(a.error).toBeNull();
    expect(a.data).toHaveLength(1);
  });

  it("學生從 line_light_events 只讀得到自己組", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("line_light_events").select("line_id").in("line_id", [seed.lineA, seed.lineB]);
    expect(error).toBeNull();
    const lineIds = new Set((data ?? []).map((e) => e.line_id));
    expect(lineIds.has(seed.lineA)).toBe(true);
    expect(lineIds.has(seed.lineB)).toBe(false);
  });

  it("不在名單上的學校帳號什麼都讀不到（periods 也是空的）", async () => {
    const db = await clientAs("stranger@g.nccu.edu.tw");
    const periods = await db.from("periods").select("id");
    expect(periods.error).toBeNull();
    expect(periods.data).toEqual([]);
    const members = await db.from("members").select("id");
    expect(members.error).toBeNull();
    expect(members.data).toEqual([]);
  });

  it("使用者連線直接 insert／update／delete progress_reports 一律失敗", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const insert = await db.from("progress_reports").insert({
      line_id: seed.lineA,
      period_id: seed.periodIds[1],
      light: "green",
      did: "x",
      blocked: "x",
      next_steps: "x",
      submitted_by: "a1@g.nccu.edu.tw",
      pdf_key: "x",
      pdf_size: 1,
      pdf_uploaded_at: new Date().toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
    });
    expect(insert.error).not.toBeNull();

    // 沒有 update／delete 政策時，RLS 預設拒絕：不會噴錯，但影響 0 筆（用 select() 取回受影響列來驗證)。
    const update = await db.from("progress_reports").update({ light: "red" }).eq("line_id", seed.lineA).select();
    expect(update.error).toBeNull();
    expect(update.data).toEqual([]);

    const del = await db.from("progress_reports").delete().eq("line_id", seed.lineA).select();
    expect(del.error).toBeNull();
    expect(del.data).toEqual([]);
  });
});
