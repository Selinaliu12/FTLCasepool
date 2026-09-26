import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccess } from "@/server/session";
import { loadMyGroup } from "@/server/queries/my-group";
import { LightBadge } from "@/components/light-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "cn";
import { formatTaipei } from "@/domain/time";
import { lateBy } from "@/domain/progress";
import { overdueLabel } from "@/domain/lights";
import { SubmittedToast } from "./submitted-toast";
import { daysLeft } from "./period-status";
import { CheckinDialog } from "./checkin-dialog";
import { LIGHT_LABEL } from "@/domain/lights";

export default async function MyGroupPage() {
  const access = await getAccess();
  // 幹部／管理員不該看到這頁：(app)/page.tsx 已經把他們導到別的地方，這裡再擋一次，
  // 涵蓋「幹部直接打這條網址」的情況。
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    redirect("/");
  }

  const data = await loadMyGroup();
  const now = new Date();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <SubmittedToast />

      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">{data.groupName}</h1>
        <p className="text-muted-foreground">{data.projectName}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <LightBadge light={data.display.light} source={data.display.source} />
        <span className="text-sm text-muted-foreground">
          準時率：{data.onTime === null ? "—" : `${Math.round(data.onTime * 100)}%`}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">最近回報</p>
          <p className="text-sm text-foreground">
            {data.latestReport
              ? `${LIGHT_LABEL[data.latestReport.light]} · ${data.latestReport.name} · ${formatTaipei(data.latestReport.at)}`
              : "還沒有組員回報"}
          </p>
        </div>
        <CheckinDialog />
      </div>

      <div className="flex flex-col gap-3">
        {data.periods.map((p) => {
          const overdue = !p.report ? lateBy(p.deadline, now) : { late: false as const };
          const remainingDays = daysLeft(p.deadline, now);

          return (
            <Card key={p.periodId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base font-medium">
                  <span>第 {p.seq} 期</span>
                  <span className="font-mono text-sm font-normal text-muted-foreground">
                    {formatTaipei(p.deadline)} 截止
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {p.report ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm">
                      已交 · {p.report.submittedBy} · {formatTaipei(p.report.submittedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {now >= p.report.lockedAt ? "已鎖定" : `可修改到 ${formatTaipei(p.report.lockedAt)}`}
                    </p>
                  </div>
                ) : overdue.late ? (
                  <p className="text-sm text-[color:var(--danger,#B3261E)]">
                    本期已{overdueLabel(overdue.hours)}，仍可補交
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    未交 · 剩 {remainingDays} 天
                  </p>
                )}
                {/* 這是導頁連結，不是就地動作，所以用真的 <a>（Link）配上按鈕樣式，
                    不用 Base UI 的 Button——它的 render prop 會把 role 蓋成 "button"，
                    跟「這其實是連結」的語意與 a11y 樹不符。 */}
                <Link
                  href={`/my-group/periods/${p.periodId}`}
                  className={cn(buttonVariants({ variant: p.report ? "outline" : "default" }))}
                >
                  {p.report ? "查看這期" : "交這期進度"}
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
