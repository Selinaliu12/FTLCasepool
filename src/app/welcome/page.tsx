import { redirect } from "next/navigation";
import { requireOk } from "@/server/session";
import { hasAcknowledged } from "@/server/actions/acknowledge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AcceptButton } from "./accept-button";

// 規格 4.2 的五點說明，逐字照抄，不改寫。
const NOTICE_POINTS = [
  "學期中，你的進度內容只有自己組員、專案幹部和系統管理員看得到。其他幹部只看得到燈號與階段。",
  "期末資料會匯出到社團雲端硬碟，只有幹部看得到。",
  "系統管理員維護時技術上碰得到所有資料。",
  "上傳後 2 小時內可以刪除重傳，之後鎖定、永久保存。替換檔案後，繳交時間以新檔案為準。",
  "只收 PDF，每份最大 20MB。",
];

// /welcome 在 (app) 群組外面，requireOk() 沒有機會經過 (app)/layout.tsx，所以這裡自己重跑
// 一次一樣的規則：wrong_domain／not_in_roster／沒有學期的非管理員都被 requireOk() 導走；
// 沒有學期的管理員（kind "no_semester"）沒有東西可以承認，直接送回首頁。
export default async function WelcomePage() {
  const access = await requireOk();
  if (access.kind !== "ok") {
    redirect("/");
  }

  // 這學期已經按過了，不需要再看一次說明。
  if (await hasAcknowledged(access.semesterId, access.email)) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md gap-6 !py-8" style={{ boxShadow: "var(--card-shadow)" }}>
        <CardHeader className="px-8">
          <CardTitle className="text-center font-heading text-2xl font-bold text-foreground">
            使用前請先閱讀
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-8 px-8">
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-foreground">
            {NOTICE_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ol>
          <AcceptButton />
        </CardContent>
      </Card>
    </main>
  );
}
