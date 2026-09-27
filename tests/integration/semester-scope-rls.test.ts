import { beforeAll, describe, it, expect } from "vitest";
import { resetDb, seedSemester, clientAs } from "./helpers";
import { createServiceSupabase } from "../../src/server/supabase";

// Final review IMPORTANT 4：批次 2 新增的 RLS（competition_entries／entry_members／
// stage_submissions／stage_status）只讓「組別屬於當前學期」的列可讀。is_staff() 本身只看
// 「這個人是不是當前學期的幹部」，不會限制他看的那一列屬於哪個學期——沒有這個條件，這學期的
// 專案幹部／其他幹部讀得到上學期所有組的報名、參賽成員、階段繳交。
let pastEntryId: string;
let pastLineId: string;
let pastSubmissionId: string;
let currentEntryId: string;
let currentLineId: string;

beforeAll(async () => {
  await resetDb();
  const seed = await seedSemester();
  const db = createServiceSupabase();

  const { data: past, error: pastError } = await db
    .from("semesters")
    .insert({ name: "114-2", is_current: false })
    .select()
    .single();
  if (pastError) throw pastError;

  const { data: pastGroup, error: pgError } = await db
    .from("groups")
    .insert({ semester_id: past.id, name: "舊第1組", project_name: "舊專案" })
    .select()
    .single();
  if (pgError) throw pgError;

  const { data: pastMember, error: pmError } = await db
    .from("members")
    .insert({ semester_id: past.id, email: "old@g.nccu.edu.tw", name: "舊生", role: "student", group_id: pastGroup.id })
    .select()
    .single();
  if (pmError) throw pmError;

  async function entryWithSubmission(semesterId: string, groupId: string, memberId: string, key: string) {
    const { data: competition, error: cError } = await db
      .from("competitions")
      .insert({
        semester_id: semesterId,
        name: `比賽-${key}`,
        url: "https://example.com",
        signup_deadline: "2099-12-01T15:59:59.999Z",
        status: "published",
        created_by: "pm@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (cError) throw cError;

    const { data: entry, error: eError } = await db
      .from("competition_entries")
      .insert({ group_id: groupId, competition_id: competition.id, created_by: "x@g.nccu.edu.tw", confirmed_at: new Date().toISOString() })
      .select()
      .single();
    if (eError) throw eError;

    const { error: emError } = await db.from("entry_members").insert({ entry_id: entry.id, member_id: memberId });
    if (emError) throw emError;

    const { data: line, error: lError } = await db
      .from("lines")
      .insert({ group_id: groupId, kind: "competition", entry_id: entry.id })
      .select()
      .single();
    if (lError) throw lError;

    const { data: sub, error: sError } = await db
      .from("stage_submissions")
      .insert({
        line_id: line.id,
        stage: "signup",
        version: 1,
        pdf_key: `scope/${key}.pdf`,
        pdf_size: 1024,
        pdf_uploaded_at: new Date().toISOString(),
        pdf_uploaded_by: "x@g.nccu.edu.tw",
        submitted_by: "x@g.nccu.edu.tw",
      })
      .select()
      .single();
    if (sError) throw sError;

    return { entryId: entry.id as string, lineId: line.id as string, submissionId: sub.id as string };
  }

  const pastRows = await entryWithSubmission(past.id, pastGroup.id, pastMember.id, "past");
  pastEntryId = pastRows.entryId;
  pastLineId = pastRows.lineId;
  pastSubmissionId = pastRows.submissionId;

  const { data: a1 } = await db
    .from("members")
    .select("id")
    .eq("semester_id", seed.semesterId)
    .eq("email", "a1@g.nccu.edu.tw")
    .single();
  const currentRows = await entryWithSubmission(seed.semesterId, seed.groupA, a1!.id as string, "current");
  currentEntryId = currentRows.entryId;
  currentLineId = currentRows.lineId;
});

describe.each(["pm@g.nccu.edu.tw", "off@g.nccu.edu.tw"])("RLS 學期範圍：%s", (email) => {
  it("competition_entries：看不到上學期的報名，看得到這學期的", async () => {
    const db = await clientAs(email);
    const { data, error } = await db.from("competition_entries").select("id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).not.toContain(pastEntryId);
    expect(ids).toContain(currentEntryId);
  });

  it("entry_members：看不到上學期報名的參賽成員，看得到這學期的", async () => {
    const db = await clientAs(email);
    const { data, error } = await db.from("entry_members").select("entry_id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.entry_id);
    expect(ids).not.toContain(pastEntryId);
    expect(ids).toContain(currentEntryId);
  });

  it("stage_status：看不到上學期比賽線的階段狀態，看得到這學期的", async () => {
    const db = await clientAs(email);
    const { data, error } = await db.from("stage_status").select("line_id");
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.line_id);
    expect(ids).not.toContain(pastLineId);
    expect(ids).toContain(currentLineId);
  });
});

describe("RLS 學期範圍：stage_submissions（內容）", () => {
  it("專案幹部看不到上學期的階段繳交，看得到這學期的", async () => {
    const db = await clientAs("pm@g.nccu.edu.tw");
    const { data, error } = await db.from("stage_submissions").select("id, line_id");
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).not.toContain(pastSubmissionId);
    expect((data ?? []).map((r) => r.line_id)).toContain(currentLineId);
  });
});

// Mutation check（手動，結果記在 final-fix-report.md）：把 20260927000020 裡任何一條 policy／
// 視圖的學期條件拿掉，對應的「看不到上學期」斷言會變紅。
