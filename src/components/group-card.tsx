import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { LightBadge } from "@/components/light-badge";
import { cn } from "cn";
import { worstLight, formatNextDeadline, type GroupCard as GroupCardData } from "@/domain/dashboard";

const BORDER_CLASS: Record<"red" | "yellow" | "green", string> = {
  red: "ring-1 ring-[color:var(--danger,#B3261E)]/40",
  yellow: "ring-1 ring-[color:var(--warn,#8A5300)]/40",
  green: "",
};

export function GroupCard({
  card,
  isMine,
  canViewContent = false,
}: {
  card: GroupCardData;
  isMine: boolean;
  canViewContent?: boolean;
}) {
  const light = worstLight(card);
  const projectLine = card.lines.find((l) => l.kind === "project");
  const competitionLines = card.lines.filter((l) => l.kind === "competition");

  return (
    <Card className={cn(BORDER_CLASS[light])}>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2 text-base font-medium">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-lg font-bold text-foreground">{card.groupName}</span>
            {/* Adjustments controller ruling：專案名稱選填，只有填了才顯示。 */}
            {card.projectName ? <span className="text-sm font-normal text-muted-foreground">{card.projectName}</span> : null}
          </div>
          {isMine ? <Badge variant="secondary">你負責</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {projectLine && projectLine.light !== null && projectLine.source !== null ? (
          <LightBadge light={projectLine.light} source={projectLine.source} />
        ) : null}
        <div>
          <p className="text-xs text-muted-foreground">組別備註</p>
          {/* Fix round 1 F5：break-words（+ whitespace-pre-wrap 保留換行）避免一長串沒有空白的
              英文字或網址把卡片撐出畫面（尤其是 375px）。 */}
          <p className="whitespace-pre-wrap text-sm text-foreground break-words">{card.note ?? "尚未訂題"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">組員</p>
          {/* Fix round 1 F8：組員是空的（名單匯入問題、或組還沒有人）不該整段消失不見——
              對幹部來說「這組沒有組員」本身就是該被看到的異常，不是不用顯示的空狀態。 */}
          {card.members.length > 0 ? (
            <ul className="text-sm text-foreground">
              {card.members.map((m, i) => (
                <li key={`${m.name}-${i}`}>
                  {m.name} · {m.deptYear ?? "—"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground">尚未有組員</p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">目前階段</p>
          <p className="text-sm text-foreground">{card.stage}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">下一個截止</p>
          <p className="font-mono text-sm text-foreground">{formatNextDeadline(card.nextDeadline)}</p>
          {card.nextDeadline ? (
            <p className="text-xs text-muted-foreground">{card.nextDeadline.lineLabel}</p>
          ) : null}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">準時率</p>
          <p className="text-sm text-foreground">
            {projectLine?.onTime === null || projectLine?.onTime === undefined
              ? "—"
              : `${Math.round(projectLine.onTime * 100)}%`}
          </p>
        </div>
        {competitionLines.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-[var(--line,#DEE9F8)] pt-3">
            <p className="text-xs text-muted-foreground">比賽</p>
            {competitionLines.map((l) => (
              <div key={l.lineId} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-foreground">{l.label}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Final review IMPORTANT 2：每條比賽線都顯示目前狀態（準備中／已報名／…／得獎／
                        未入選）；已結束的線（得獎／未入選——已退出在 dashboard 查詢層就整條濾掉了）
                        沒有系統燈，只剩狀態徽章。 */}
                    {l.status ? <Badge variant="secondary">{l.status}</Badge> : null}
                    {l.light !== null && l.source !== null ? <LightBadge light={l.light} source={l.source} /> : null}
                    <span className="text-xs text-muted-foreground">
                      {l.onTime === null ? "準時 —" : `準時 ${Math.round(l.onTime * 100)}%`}
                    </span>
                  </div>
                </div>
                {l.nextStage ? (
                  <p className="font-mono text-xs text-muted-foreground">{`${l.nextStage.label} ${l.nextStage.text}`}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {canViewContent ? (
          <Link href={`/groups/${card.groupId}`} className={cn(buttonVariants({ variant: "outline" }), "self-start")}>
            看內容
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
