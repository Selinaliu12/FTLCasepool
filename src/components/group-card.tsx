import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LightBadge } from "@/components/light-badge";
import { cn } from "cn";
import { worstLight, formatNextDeadline, type GroupCard as GroupCardData } from "@/domain/dashboard";

const BORDER_CLASS: Record<"red" | "yellow" | "green", string> = {
  red: "ring-1 ring-[color:var(--danger,#B3261E)]/40",
  yellow: "ring-1 ring-[color:var(--warn,#8A5300)]/40",
  green: "",
};

export function GroupCard({ card, isMine }: { card: GroupCardData; isMine: boolean }) {
  const light = worstLight(card);
  const line = card.lines[0];

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
        {line ? <LightBadge light={line.light} source={line.source} /> : null}
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
            {line?.onTime === null || line?.onTime === undefined ? "—" : `${Math.round(line.onTime * 100)}%`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
