import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccess } from "@/server/session";
import { loadMyGroup } from "@/server/queries/my-group";
import { loadMyGroupEntries } from "@/server/queries/entries";
import { ENTRY_STATUS_LABEL } from "@/domain/entries";
import { LightBadge } from "@/components/light-badge";
import { SubmissionTiming } from "@/components/submission-timing";
import { CheckinHistory } from "@/components/checkin-history";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "cn";
import { formatTaipei } from "@/domain/time";
import { lateBy } from "@/domain/progress";
import { overdueLabel } from "@/domain/lights";
import { SubmittedToast } from "../submitted-toast";
import { daysLeft } from "../period-status";
import { CheckinDialog } from "../checkin-dialog";
import { LIGHT_LABEL } from "@/domain/lights";
import type { Stage } from "@/domain/competition-line";

const STAGE_SUBMIT_STATE_LABEL: Record<"none" | "pending" | "approved" | "returned", string> = {
  none: "未交",
  pending: "待審",
  approved: "已通過",
  returned: "被退回",
};

function stageSubmitState(stage: Stage): "none" | "pending" | "approved" | "returned" {
  return stage.latest?.status ?? "none";
}

export default async function MyGroupPage() {
  const access = await getAccess();
  // 幹部／管理員不該看到這頁：(app)/page.tsx 已經把他們導到別的地方，這裡再擋一次，
  // 涵蓋「幹部直接打這條網址」的情況。
  if (access.kind !== "ok" || !access.member || access.member.role !== "student" || !access.member.groupId) {
    redirect("/");
  }

  const data = await loadMyGroup();
  const entries = await loadMyGroupEntries();
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
                {p.suggestion && (
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    本期建議繳交：{p.suggestion}
                  </p>
                )}
                {p.report ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span>
                        已交 · {p.report.submittedBy} · {formatTaipei(p.report.submittedAt)}
                      </span>
                      <SubmissionTiming deadline={p.deadline} submittedAt={p.report.submittedAt} />
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

      {entries.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-bold text-foreground">比賽</h2>
          <div className="flex flex-col gap-3">
            {entries.map((e) => {
              const line = data.competitionLines.find((cl) => cl.entryId === e.entryId);
              // 還沒確認報名（沒有比賽線）：維持 Task 3 的簡單連結列，還沒有階段可以看。
              if (!line) {
                return (
                  <Link
                    key={e.entryId}
                    href={`/my-group/competitions/${e.entryId}`}
                    className="flex items-center justify-between rounded-[var(--r-sm,12px)] border border-[var(--line,#DEE9F8)] p-3 text-sm hover:bg-muted"
                  >
                    <span className="text-foreground">{e.competitionName}</span>
                    <span className="text-muted-foreground">{ENTRY_STATUS_LABEL[e.status]}</span>
                  </Link>
                );
              }
              return (
                <Card key={e.entryId}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base font-medium">
                      <Link href={`/my-group/competitions/${e.entryId}`} className="text-foreground hover:underline">
                        {line.competitionName}
                      </Link>
                      <Badge variant="secondary">{line.status}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {/* fix round 1：已結束的線（已退出／得獎／未入選）沒有系統燈，上面的狀態
                        徽章已經說明成果，這裡不再畫 LightBadge。 */}
                    {line.light !== null && line.source !== null ? (
                      <LightBadge light={line.light} source={line.source} />
                    ) : null}
                    <div className="flex flex-col gap-2">
                      {line.stages.map((stage) => (
                        <div
                          key={stage.key}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--r-sm,12px)] border border-[var(--line,#DEE9F8)] p-2 text-sm"
                        >
                          <span className="font-medium text-foreground">{stage.label}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {stage.deadline ? formatTaipei(stage.deadline) : "尚未公布"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {STAGE_SUBMIT_STATE_LABEL[stageSubmitState(stage)]}
                          </span>
                        </div>
                      ))}
                    </div>
                    {line.onTime !== null && (
                      <p className="text-xs text-muted-foreground">準時率：{Math.round(line.onTime * 100)}%</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <CheckinHistory checkins={data.checkins} />
    </main>
  );
}
