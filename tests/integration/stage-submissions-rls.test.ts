import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";
import { createServiceSupabase } from "../../src/server/supabase";

let seed: Awaited<ReturnType<typeof seedSemester>>;
let lineId: string;
let submissionId: string;

beforeAll(async () => {
  await resetDb();
  seed = await seedSemester();

  const db = createServiceSupabase();
  const { data: competition, error: competitionError } = await db
    .from("competitions")
    .insert({
      semester_id: seed.semesterId,
      name: "黑客松",
      url: "https://example.com",
      signup_deadline: "2099-12-01T15:59:59.999Z",
      status: "published",
      created_by: "pm@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (competitionError) throw competitionError;

  const { data: entry, error: entryError } = await db
    .from("competition_entries")
    .insert({
      group_id: seed.groupA,
      competition_id: competition.id,
      created_by: "a1@g.nccu.edu.tw",
      confirmed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (entryError) throw entryError;

  const { data: line, error: lineError } = await db
    .from("lines")
    .insert({ group_id: seed.groupA, kind: "competition", entry_id: entry.id })
    .select()
    .single();
  if (lineError) throw lineError;
  lineId = line.id as string;

  const { data: submission, error: submissionError } = await db
    .from("stage_submissions")
    .insert({
      line_id: lineId,
      stage: "signup",
      version: 1,
      pdf_key: "stage-submissions/test/signup-v1.pdf",
      pdf_size: 1024,
      pdf_uploaded_at: new Date().toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
      submitted_by: "a1@g.nccu.edu.tw",
    })
    .select()
    .single();
  if (submissionError) throw submissionError;
  submissionId = submission.id as string;
});

describe("RLS：stage_submissions（內容）", () => {
  it("這組的學生看得到自己組的階段繳交內容", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_submissions").select("id").eq("id", submissionId);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(submissionId);
  });

  it("專案幹部看得到所有組的階段繳交內容", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_submissions").select("id").eq("id", submissionId);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(submissionId);
  });

  it("其他幹部看不到階段繳交內容（can_read_content 不含 officer）", async () => {
    const db = await clientAs("off@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_submissions").select("id").eq("id", submissionId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("別組的學生看不到", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_submissions").select("id").eq("id", submissionId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("使用者連線直接 insert／update／delete 一律失敗", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const insert = await db.from("stage_submissions").insert({
      line_id: lineId,
      stage: "signup",
      version: 2,
      pdf_key: "stage-submissions/test/signup-v2.pdf",
      pdf_size: 1024,
      pdf_uploaded_at: new Date().toISOString(),
      pdf_uploaded_by: "a1@g.nccu.edu.tw",
      submitted_by: "a1@g.nccu.edu.tw",
    });
    expect(insert.error).not.toBeNull();

    const update = await db.from("stage_submissions").update({ review_status: "approved" }).eq("id", submissionId).select();
    expect(update.error).not.toBeNull();

    const del = await db.from("stage_submissions").delete().eq("id", submissionId).select();
    expect(del.error).not.toBeNull();
  });
});

describe("RLS：stage_status（狀態視圖，其他幹部也看得到）", () => {
  it("其他幹部從 stage_status 看不到內容欄位，但看得到狀態", async () => {
    const db = await clientAs("off@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_status").select("*").eq("line_id", lineId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toEqual({
      line_id: lineId,
      stage: "signup",
      version: 1,
      pdf_uploaded_at: data![0].pdf_uploaded_at,
      review_status: "pending",
      reviewed_at: null,
    });
    // 內容欄位（pdf_key／submitted_by／comment 等）不在這個視圖裡。
    expect(Object.keys(data![0]).sort()).toEqual(
      ["line_id", "pdf_uploaded_at", "review_status", "reviewed_at", "stage", "version"].sort()
    );
  });

  it("這組的學生也看得到自己組的狀態", async () => {
    const db = await clientAs("a1@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_status").select("line_id").eq("line_id", lineId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("別組的學生看不到", async () => {
    const db = await clientAs("b1@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_status").select("line_id").eq("line_id", lineId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

// Mutation check（手動跑一次，記錄在 task-4-report.md）：暫時把 read_stage_submissions 政策
// 放寬成 `using (true)`，確認「其他幹部看不到階段繳交內容」會變紅，再用同一份 migration 的
// SQL 復原；stage_status 的 can_read_status(line_id) 條件同理，暫時放寬成 `using (true)`
// 確認「別組的學生看不到」會變紅。
