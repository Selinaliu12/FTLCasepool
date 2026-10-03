import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "隱私權說明 · FTL 競賽池" };

const CONTACT = "nccufintechlab@gmail.com";

// Google OAuth 同意畫面切成正式版時需要的公開隱私權政策網址；不用登入就能看（見 middleware 的 PUBLIC）。
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <article className="mx-auto flex max-w-2xl flex-col gap-8 text-foreground">
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-bold">隱私權說明</h1>
          <p className="text-sm text-muted-foreground">FTL 競賽池 · 政大金融科技創新實驗室（FTL）社團 · 最後更新 2026/09/28</p>
        </header>

        <Section title="這個網站是做什麼的">
          <p>FTL 競賽池是社團內部的專案進度追蹤工具，只給本學期名單上的社員與幹部使用，用來繳交雙週進度、管理比賽報名與階段檔案。</p>
        </Section>

        <Section title="我們收集哪些資料">
          <ul className="list-disc space-y-1 pl-5">
            <li>用 Google 登入時取得的信箱與姓名（不會取得你的密碼，也不會讀取你的 Google 雲端硬碟、信件等其他資料）。</li>
            <li>幹部匯入的社員名單：姓名、學號、系級、組別與角色。</li>
            <li>你在網站上填寫或上傳的內容：進度燈號、三句話、PDF 檔案、比賽報名與結果、組別備註。</li>
            <li>維持登入狀態與記住你目前身份所需的 cookie。</li>
          </ul>
        </Section>

        <Section title="資料存放在哪裡">
          <p>資料庫與登入服務使用 Supabase（東京機房），PDF 檔案存放在 Cloudflare R2，網站架設在 Vercel。這些服務只替社團保管資料，不會拿來做其他用途。</p>
        </Section>

        <Section title="誰看得到">
          <ul className="list-disc space-y-1 pl-5">
            <li>專案生：只看得到自己組的內容。</li>
            <li>專案幹部與管理員：看得到各組的進度內容，以便協助各組。</li>
            <li>其他幹部：看得到各組的燈號、階段與組員，看不到進度內容與 PDF。</li>
          </ul>
          <p>資料只在社團內使用，不會出售或提供給社團以外的人。</p>
        </Section>

        <Section title="資料保留與刪除">
          <p>資料保留到該學期結束，社團確認不再需要後會刪除。想查詢或刪除自己的資料，請寫信給我們。</p>
        </Section>

        <Section title="聯絡我們">
          <p>
            <a href={`mailto:${CONTACT}`} className="text-primary underline underline-offset-4">
              {CONTACT}
            </a>
          </p>
        </Section>

        <Link href="/login" className="text-sm text-primary underline underline-offset-4">
          回登入頁
        </Link>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 leading-relaxed">
      <h2 className="font-heading text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}
