import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatTaipei } from "@/domain/time";
import { deadlineLabel } from "@/domain/competition-label";
import type { CompetitionCard as CompetitionCardData } from "@/domain/competition";

export function CompetitionCard({
  card,
  now,
  draft = false,
  canEdit = false,
}: {
  card: CompetitionCardData;
  now: Date;
  draft?: boolean;
  canEdit?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2 text-base font-medium">
          <span className="font-heading text-lg font-bold text-foreground">{card.name}</span>
          {draft && <Badge variant="secondary">草稿</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {card.organizer && (
          <p>
            <span className="text-muted-foreground">主辦：</span>
            {card.organizer}
          </p>
        )}
        {card.theme && (
          <p>
            <span className="text-muted-foreground">主題：</span>
            {card.theme}
          </p>
        )}
        {card.eligibility && (
          <p>
            <span className="text-muted-foreground">參賽資格：</span>
            {card.eligibility}
          </p>
        )}
        {card.teamSize && (
          <p>
            <span className="text-muted-foreground">隊伍人數：</span>
            {card.teamSize}
          </p>
        )}
        {card.prize && (
          <p>
            <span className="text-muted-foreground">獎項：</span>
            {card.prize}
          </p>
        )}
        <p>
          <span className="text-muted-foreground">報名截止：</span>
          <span className="font-mono">{formatTaipei(card.signupDeadline)}</span>{" "}
          <span className="text-muted-foreground">（{deadlineLabel(card.signupDeadline, now)}）</span>
        </p>
        {card.submissionDeadline && (
          <p>
            <span className="text-muted-foreground">繳件截止：</span>
            <span className="font-mono">{formatTaipei(card.submissionDeadline)}</span>
          </p>
        )}
        {card.finalDate && (
          <p>
            <span className="text-muted-foreground">決賽日期：</span>
            <span className="font-mono">{formatTaipei(card.finalDate)}</span>
          </p>
        )}
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          官方連結
        </a>
        {canEdit && (
          <Link
            href={`/competitions/${card.id}/edit`}
            className={buttonVariants({ variant: "outline", className: "self-start" })}
          >
            編輯
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
