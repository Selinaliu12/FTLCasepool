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
            <span className="text-sm font-normal text-muted-foreground">{card.projectName}</span>
          </div>
          {isMine ? <Badge variant="secondary">你負責</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {projectLine && projectLine.light !== null && projectLine.source !== null ? (
          <LightBadge light={projectLine.light} source={projectLine.source} />
        ) : null}
        <div>
          <p className="text-xs text-muted-foreground">目前階段</p>
          <p className="text-sm text-foreground">{card.stage}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">下一個截止</p>
          <p className="font-mono text-sm text-foreground">{formatNextDeadline(card.nextDeadline)}</p>
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
              <div key={l.lineId} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-foreground">{l.label}</span>
                <div className="flex items-center gap-2">
                  {/* fix round 1：已結束的線（得獎／未入選——已退出在 dashboard 查詢層就整條
                      濾掉了）沒有系統燈，改顯示成果徽章。 */}
                  {l.light !== null && l.source !== null ? (
                    <LightBadge light={l.light} source={l.source} />
                  ) : l.status ? (
                    <Badge variant="secondary">{l.status}</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {l.onTime === null ? "—" : `準時 ${Math.round(l.onTime * 100)}%`}
                  </span>
                </div>
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
