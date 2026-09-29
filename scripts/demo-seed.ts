// 本機示範資料（只給產品負責人檢視畫面用，不進專案的正式資料）。只能對本機 Supabase 執行——
// 執行前先跑 `npx supabase db reset` 清空重建 schema，這支script只管灌資料，不清資料表。
//
// Adjustments（規格 §14）之後的新名單格式：email,姓名,角色,學號,系級,組別,專案名稱。這裡直接寫
// members/groups 表（不是走 CSV），但欄位、多身份規則跟 import_roster() 一致：
// - 學號／系級可以是 null（有些組員系級留白，示範「—」怎麼顯示）。
// - 同一個人可以有多列（多組專案生、或專案生兼專案幹部）——見 multiIdentityEmail。
// - 組別備註（note）有些組填了、有些留白（顯示「尚未訂題」）。
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../src/server/env";
import { assertLocalSupabaseUrl, isLocalSupabaseUrl } from "../src/server/local-only";

assertLocalSupabaseUrl(env.supabaseUrl);
// Final whole-branch review F5：assertLocalSupabaseUrl 只擋 Supabase，沒擋 R2。這支腳本上傳的
// PDF 一律走 env.r2.endpoint；如果 .env.local 沒設 R2_ENDPOINT（或設成別的網址），uploadTestPdf
// 會退回組出真正的 R2 端點（https://{accountId}.r2.cloudflarestorage.com），示範用的檔案就會
// 傳到正式（或別人的測試）R2 桶，而且沒有對應的資料庫列可以清掉——一樣要求它是本機位址才能跑。
if (!env.r2.endpoint || !isLocalSupabaseUrl(env.r2.endpoint)) {
  throw new Error(
    `Refusing to run: R2_ENDPOINT is not set to a local host (got ${env.r2.endpoint ?? "(未設定)"}). ` +
      "This script uploads PDFs to whatever R2_ENDPOINT points at; set it to your local Supabase Storage S3 endpoint (e.g. http://127.0.0.1:54321/storage/v1/s3) before running."
  );
}
const db = createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
const pdf = new Uint8Array(readFileSync(new URL("../tests/fixtures/sample.pdf", import.meta.url)));

const D = "@g.nccu.edu.tw";
const tpe = (s: string) => new Date(`${s}+08:00`).toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

async function must<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null) throw new Error("預期有回傳資料，但拿到 null");
  return data;
}

async function ensureLocalStorageBucket(): Promise<void> {
  if (!env.r2.endpoint) return;
  const { error } = await db.storage.createBucket(env.r2.bucket, { public: false });
  if (error && !error.message.includes("already exists")) throw error;
}

async function uploadTestPdf(key: string, bytes: Uint8Array): Promise<void> {
  const r2 = env.r2;
  const endpoint = r2.endpoint ?? `https://${r2.accountId}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: r2.region,
    endpoint,
    forcePathStyle: !!r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  await s3.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: bytes, ContentType: "application/pdf" }));
}

async function main() {
  await ensureLocalStorageBucket();

  const [sem] = await must(db.from("semesters").insert({ name: "115-1", is_current: true }).select("id,name"));

  // 一個人同時是第2組專案生、第4組專案生、又兼專案幹部（多身份示範，用來測身份切換選單）。
  // test-login 網址：http://localhost:3000/test-login?email=multi1@g.nccu.edu.tw
  const multiIdentityEmail = `multi1${D}`;

  const groupDefs: {
    name: string;
    project: string;
    students: [string, string, string | null, string | null][]; // [studentId, name, studentNo, deptYear]
  }[] = [
    {
      name: "第1組",
      project: "智慧記帳",
      students: [
        ["s11", "王小明", "110701001", "資科三"],
        ["s12", "李小華", "110701002", "資科三"],
      ],
    },
    {
      name: "第2組",
      project: "校園二手平台",
      students: [
        ["s21", "陳大同", "110701011", "資管二"],
        ["s22", "黃詩涵", "110701012", null],
        ["s23", "吳新生", "110701013", "資管二"],
      ],
    },
    {
      name: "第3組",
      project: "AI 理財助理",
      students: [
        ["s31", "張家豪", "110701021", "金融三"],
        ["s32", "劉怡君", "110701022", null],
      ],
    },
    {
      name: "第4組",
      project: "碳足跡追蹤",
      students: [
        ["s41", "蔡宗翰", "110701031", "地政三"],
        ["s42", "許雅婷", null, "地政三"],
      ],
    },
    {
      name: "第5組",
      project: "學生微型保險",
      students: [
        ["s51", "鄭博文", "110701041", "風保四"],
        ["s52", "謝佳穎", "110701042", "風保四"],
      ],
    },
  ];

  const groups: Record<string, { id: string; line: string }> = {};
  for (const g of groupDefs) {
    const [row] = await must(db.from("groups").insert({ semester_id: sem.id, name: g.name, project_name: g.project }).select("id"));
    const [line] = await must(db.from("lines").insert({ group_id: row.id, kind: "project" }).select("id"));
    groups[g.name] = { id: row.id, line: line.id };
    await must(
      db
        .from("members")
        .insert(
          g.students.map(([u, n, studentId, deptYear]) => ({
            semester_id: sem.id,
            email: `${u}${D}`,
            name: n,
            role: "student",
            group_id: row.id,
            student_id: studentId,
            dept_year: deptYear,
          }))
        )
        .select("id")
    );
  }

  // 多身份成員：第2組、第4組的專案生列（沿用兩組的名單，姓名／學號／系級一致），再加一列專案幹部。
  await must(
    db
      .from("members")
      .insert([
        {
          semester_id: sem.id,
          email: multiIdentityEmail,
          name: "洪多身",
          role: "student",
          group_id: groups["第2組"].id,
          student_id: "110701099",
          dept_year: "資管四",
        },
        {
          semester_id: sem.id,
          email: multiIdentityEmail,
          name: "洪多身",
          role: "student",
          group_id: groups["第4組"].id,
          student_id: "110701099",
          dept_year: "資管四",
        },
        {
          semester_id: sem.id,
          email: multiIdentityEmail,
          name: "洪多身",
          role: "pm",
          group_id: null,
          student_id: "110701099",
          dept_year: "資管四",
        },
      ])
      .select("id")
  );

  // Task 8 part B：標一個成員已離開，示範管理員頁「成員」區塊預設隱藏已離開的人、勾選「顯示
  // 已離開」才看得到，以及紀錄上姓名標「（已離開）」怎麼顯示。s23 沒按過「我已了解」，離開也不
  // 影響已經跑過的期報告／點燈紀錄。
  await must(db.from("members").update({ left_at: hoursAgo(200) }).eq("semester_id", sem.id).eq("email", `s23${D}`).select("id"));

  const staff = await must(
    db
      .from("members")
      .insert([
        { semester_id: sem.id, email: `pm1${D}`, name: "陳專案", role: "pm", group_id: null },
        { semester_id: sem.id, email: `pm2${D}`, name: "林專案", role: "pm", group_id: null },
        { semester_id: sem.id, email: `off${D}`, name: "張公關", role: "officer", group_id: null },
      ])
      .select("id,email")
  );
  const pm1 = staff.find((m) => m.email === `pm1${D}`)!.id;
  const pm2 = staff.find((m) => m.email === `pm2${D}`)!.id;
  await must(
    db
      .from("pm_assignments")
      .insert([
        { pm_member_id: pm1, group_id: groups["第1組"].id },
        { pm_member_id: pm1, group_id: groups["第2組"].id },
        { pm_member_id: pm1, group_id: groups["第3組"].id },
        { pm_member_id: pm2, group_id: groups["第4組"].id },
        { pm_member_id: pm2, group_id: groups["第5組"].id },
      ])
      .select("pm_member_id")
  );

  const periods = await must(
    db
      .from("periods")
      .insert([
        { semester_id: sem.id, seq: 1, deadline: tpe("2026-09-12T23:59:59.999") },
        { semester_id: sem.id, seq: 2, deadline: tpe("2026-09-26T23:59:59.999") },
        { semester_id: sem.id, seq: 3, deadline: tpe("2026-10-10T23:59:59.999") },
        { semester_id: sem.id, seq: 4, deadline: tpe("2026-10-24T23:59:59.999") },
        { semester_id: sem.id, seq: 5, deadline: tpe("2026-11-07T23:59:59.999") },
      ])
      .select("id,seq")
  );
  const P = (seq: number) => periods.find((p) => p.seq === seq)!.id;

  async function report(
    group: string,
    seq: number,
    by: string,
    at: string,
    light: "green" | "yellow" | "red",
    did: string,
    blocked: string,
    next: string
  ) {
    const key = `${sem.name}/${groups[group].id}/${randomUUID()}.pdf`;
    await uploadTestPdf(key, pdf);
    await must(
      db
        .from("progress_reports")
        .insert({
          line_id: groups[group].line,
          period_id: P(seq),
          light,
          did,
          blocked,
          next_steps: next,
          submitted_by: `${by}${D}`,
          pdf_key: key,
          pdf_size: pdf.byteLength,
          pdf_uploaded_at: at,
          pdf_uploaded_by: `${by}${D}`,
          created_at: at,
          updated_at: at,
        })
        .select("id")
    );
  }
  async function checkin(group: string, by: string, at: string, light: "green" | "yellow" | "red", note: string | null) {
    await must(
      db
        .from("checkins")
        .insert({ line_id: groups[group].line, light, note, created_by: `${by}${D}`, created_at: at })
        .select("id")
    );
  }

  // 第1組：兩期都準時、全綠
  await report("第1組", 1, "s11", tpe("2026-09-11T20:10:00"), "green", "完成題目訪談 5 位同學", "還沒有", "整理訪談結論、畫使用流程");
  await report("第1組", 2, "s12", tpe("2026-09-25T22:40:00"), "green", "做出記帳頁的 Figma 雛型", "圖表套件還在選", "開始寫前端");
  await checkin("第1組", "s11", tpe("2026-09-19T12:00:00"), "green", null);

  // 第2組：第 1 期準時，第 2 期還沒交（剛逾期不到 3 天 → 系統黃燈）
  await report("第2組", 1, "s21", tpe("2026-09-12T23:30:00"), "green", "確定做校內二手交易", "法規不確定", "問學校課外組");
  await checkin("第2組", "s22", tpe("2026-09-20T09:15:00"), "yellow", null);

  // 第3組：第 1 期沒交（逾期超過 3 天 → 系統紅燈），第 2 期有交
  await report("第3組", 2, "s31", tpe("2026-09-26T21:05:00"), "yellow", "串好股價 API", "模型回答常常亂掰", "加上資料來源檢查");

  // 第4組：兩期都準時，但組員剛回報紅燈
  await report("第4組", 1, "s41", tpe("2026-09-10T18:00:00"), "green", "找到兩個碳排資料來源", "還沒有", "比較兩個資料來源");
  await report("第4組", 2, "s42", tpe("2026-09-26T19:20:00"), "yellow", "完成資料清理", "資料缺很多年份", "問老師要不要換題目");
  await checkin("第4組", "s41", hoursAgo(5), "red", "資料缺太多，可能要換題目，需要幹部幫忙討論");

  // 第5組：第 1 期晚交 1 天多；第 2 期 1 小時前剛交（還在 2 小時可修改內）
  await report("第5組", 1, "s51", tpe("2026-09-14T10:00:00"), "yellow", "訪談 3 位保險業務", "時間喬不攏", "把訪談整理成需求");
  await report("第5組", 2, "s52", hoursAgo(1), "green", "寫好商業模式畫布", "還沒有", "做報價試算");

  // 除了 s23（第2組新同學），大家都已按過「我已了解」；管理員也還沒按
  const acked = [
    ...groupDefs.flatMap((g) => g.students.map(([u]) => u)).filter((u) => u !== "s23"),
    "pm1",
    "pm2",
    "off",
  ];
  await must(db.from("acknowledgements").insert(acked.map((u) => ({ semester_id: sem.id, email: `${u}${D}` }))).select("email"));
  // 多身份成員也算已了解過。
  await must(db.from("acknowledgements").insert({ semester_id: sem.id, email: multiIdentityEmail }).select("email"));

  // ── 批次 2：每期建議內容 ──
  await must(db.from("periods").update({ suggestion: "本期成果截圖（至少 3 張）\n本週會議紀錄\n下期分工表" }).eq("id", P(3)).select("id"));
  await must(db.from("periods").update({ suggestion: "使用者訪談整理（至少 5 位）" }).eq("id", P(4)).select("id"));

  // ── Adjustments：組別備註（訂題後的主題）。第1、3、5組填了，第2、4組留白（「尚未訂題」）。
  await must(
    db
      .from("groups")
      .update({ note: "先做記帳頁 MVP，之後再加圖表分析", note_updated_by: "王小明", note_updated_at: hoursAgo(20) })
      .eq("id", groups["第1組"].id)
      .select("id")
  );
  await must(
    db
      .from("groups")
      .update({ note: "鎖定用 GPT 分析財報摘要，先做三大產業", note_updated_by: "張家豪", note_updated_at: hoursAgo(3) })
      .eq("id", groups["第3組"].id)
      .select("id")
  );
  await must(
    db
      .from("groups")
      .update({ note: "跟保險系合作訪談業務員，聚焦學生族群的微型保單", note_updated_by: "鄭博文", note_updated_at: hoursAgo(50) })
      .eq("id", groups["第5組"].id)
      .select("id")
  );

  // ── 批次 2：競賽卡片 ──
  const comp = async (c: Record<string, unknown>) =>
    (await must(db.from("competitions").insert({ semester_id: sem.id, created_by: `pm1${D}`, ...c }).select("id")))[0].id as string;
  // Task 8 part B：兩場給滿模板新欄位（標籤、一句話介紹、最高獎金、備註、報名費、幹部推薦、
  // 幹部備註…），示範卡片與詳細頁的完整樣子；一場（compC）只填必填三欄，示範舊資料／極簡資料
  // 不會壞、不會出現空標題或「null」。
  const compA = await comp({
    name: "2026 金融科技創新競賽",
    organizer: "金融研訓院",
    theme: "金融科技應用",
    eligibility: "大專院校在學生",
    team_size: "3–5 人",
    prize: "首獎 10 萬元",
    url: "https://example.com/fintech-2026",
    signup_deadline: tpe("2026-10-15T23:59:59.999"),
    submission_deadline: tpe("2026-11-15T23:59:59.999"),
    final_date: tpe("2026-12-10T23:59:59.999"),
    status: "published",
    summary: "金融科技新創題目，決賽入圍可獲業師輔導",
    tags: ["金融科技", "企業出題"],
    max_prize: 100000,
    perks: "入圍決賽即獲得金融研訓院實習面試機會",
    info_session_at: tpe("2026-10-01T19:00:00"),
    signup_note: "報名表需附上一頁題目構想",
    submission_note: "作品需含商業模式畫布",
    final_note: "決賽採現場簡報＋問答，每組 10 分鐘",
    final_format: "現場簡報",
    fee: "免費",
    documents: "報名表、商業模式畫布 PDF",
    skills: "資料分析、簡報製作",
    recommended: true,
    staff_note: "去年第2組拿過佳作，題目方向可以參考",
  });
  const compB = await comp({
    name: "全國大專校院創業競賽",
    organizer: "教育部",
    theme: "創業提案",
    team_size: "2–6 人",
    prize: "總獎金 50 萬元",
    url: "https://example.com/startup",
    signup_deadline: tpe("2026-09-20T23:59:59.999"),
    submission_deadline: tpe("2026-10-05T23:59:59.999"),
    status: "published",
    summary: "全國性創業提案競賽，鼓勵跨領域組隊",
    tags: ["創業", "企劃提案"],
    max_prize: 500000,
    perks: "總獎金 50 萬元，前三名獲創業基地進駐資格",
    signup_note: "需檢附學生證正反面掃描檔",
    submission_note: "簡報檔案限 20 頁以內",
    fee: "免費",
    documents: "提案簡報 PDF、學生證掃描檔",
    recommended: false,
    staff_note: "報名截止日常常延後，公告前先跟幹部確認",
  });
  // compC：只填必填三欄（名稱、官方連結、報名截止日時），示範舊資料／極簡資料的卡片與詳細頁。
  const compC = await comp({
    name: "永續金融黑客松",
    url: "https://example.com/esg-hack",
    signup_deadline: tpe("2026-10-03T23:59:59.999"),
    status: "published",
  });
  await comp({ name: "校園 AI 應用大賽（草稿）", url: "https://example.com/ai-campus", signup_deadline: tpe("2026-11-01T23:59:59.999"), status: "draft" });

  const memberId = async (u: string) =>
    (await must(db.from("members").select("id").eq("semester_id", sem.id).eq("email", `${u}${D}`)))[0].id as string;

  async function entry(group: string, compId: string, by: string, members: string[], confirmed: boolean, result: string | null = null) {
    const [e] = await must(
      db
        .from("competition_entries")
        .insert({
          group_id: groups[group].id,
          competition_id: compId,
          created_by: `${by}${D}`,
          confirmed_at: confirmed ? hoursAgo(72) : null,
          result,
        })
        .select("id")
    );
    for (const m of members) await must(db.from("entry_members").insert({ entry_id: e.id, member_id: await memberId(m) }).select("entry_id"));
    if (!confirmed) return { entryId: e.id as string, lineId: "" };
    const [l] = await must(db.from("lines").insert({ group_id: groups[group].id, kind: "competition", entry_id: e.id }).select("id"));
    return { entryId: e.id as string, lineId: l.id as string };
  }
  async function stage(
    lineId: string,
    st: string,
    version: number,
    by: string,
    at: string,
    review: { status: string; by?: string; comment?: string } = { status: "pending" }
  ) {
    const key = `${sem.name}/${randomUUID()}.pdf`;
    await uploadTestPdf(key, pdf);
    await must(
      db
        .from("stage_submissions")
        .insert({
          line_id: lineId,
          stage: st,
          version,
          pdf_key: key,
          pdf_size: pdf.byteLength,
          pdf_uploaded_at: at,
          pdf_uploaded_by: `${by}${D}`,
          submitted_by: `${by}${D}`,
          created_at: at,
          review_status: review.status,
          reviewed_by: review.by ? `${review.by}${D}` : null,
          reviewed_at: review.status === "pending" ? null : hoursAgo(1),
          comment: review.comment ?? null,
        })
        .select("id")
    );
  }

  // 第1組：金融科技競賽已確認，報名證明 5 小時前交、已鎖定 → 出現在陳專案的「待你審核」
  const e1 = await entry("第1組", compA, "s11", ["s11", "s12"], true);
  await stage(e1.lineId, "signup", 1, "s11", hoursAgo(5));
  // 第2組：金融科技競賽已確認，還沒交任何階段（報名截止在 10/15，綠燈）
  await entry("第2組", compA, "s21", ["s21", "s22"], true);
  // 第3組：創業競賽已報名（報名通過），繳件第 1 版被退回 → 黃燈
  const e3 = await entry("第3組", compB, "s31", ["s31", "s32"], true);
  await stage(e3.lineId, "signup", 1, "s31", tpe("2026-09-19T20:00:00"), { status: "approved", by: "pm1", comment: "報名證明清楚" });
  await stage(e3.lineId, "submission", 1, "s32", hoursAgo(30), { status: "returned", by: "pm1", comment: "作品說明太短，請補上市場分析與商業模式" });
  // 第4組：永續黑客松已掛上但還沒確認報名
  await entry("第4組", compC, "s41", ["s41"], false);
  // 第5組：創業競賽報名通過後填了「未入選」→ 這條線結束
  const e5 = await entry("第5組", compB, "s51", ["s51", "s52"], true, "not_selected");
  await stage(e5.lineId, "signup", 1, "s51", tpe("2026-09-18T15:00:00"), { status: "approved", by: "pm2" });

  console.log("demo seed ok");
  console.log("test-login URLs（本機、ENABLE_TEST_LOGIN=true 才開放）：");
  console.log("  管理員／幹部：需在 ADMIN_EMAILS 或以 pm1@g.nccu.edu.tw、off@g.nccu.edu.tw 登入");
  console.log(`  多身份示範（第2組專案生／第4組專案生／專案幹部）：http://localhost:3000/test-login?email=${multiIdentityEmail}`);
  console.log(`  一般專案生：http://localhost:3000/test-login?email=s11${D}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
