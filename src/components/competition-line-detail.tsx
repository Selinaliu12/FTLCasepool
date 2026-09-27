import { Badge } from "@/components/ui/badge";
import { LightBadge } from "@/components/light-badge";
import { StageReview } from "@/components/stage-review";
import { formatStageDeadline, nextRequiredStage, type Stage } from "@/domain/competition-line";
import type { CompetitionLineSummary } from "@/server/queries/competition-lines";

const STAGE_STATE_LABEL: Record<"none" | "pending" | "approved" | "returned", string> = {
  none: "未交",
  pending: "待審",
  approved: "已通過",
  returned: "被退回",
};

function stageState(stage: Stage): keyof typeof STAGE_STATE_LABEL {
  return stage.latest?.status ?? "none";
}

// /groups/[groupId] 的一條比賽線（final review IMPORTANT 2，規格 4.6）：目前狀態、燈號、準時率、
// 下一個必要階段的截止日，以及三個階段——即使還沒有任何上傳，也列出截止日與「未交」，PM 才看得
// 出這組接下來要交什麼。外層 id="competition-<lineId>" 是「待你審核」連結的錨點（minor 9）。
export function CompetitionLineDetail({
  line,
  canReview,
  now,
}: {
  line: CompetitionLineSummary;
  canReview: boolean;
  now: Date;
}) {
  const next = nextRequiredStage(line.stages);

  return (
    <div
      id={`competition-${line.lineId}`}
      className="flex scroll-mt-20 flex-col gap-3 rounded-[var(--r-sm,12px)] border border-[var(--line,#DEE9F8)] p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{line.competitionName}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{line.status}</Badge>
          {line.light !== null && line.source !== null ? <LightBadge light={line.light} source={line.source} /> : null}
          <span className="text-xs text-muted-foreground">
            {line.onTime === null ? "準時 —" : `準時 ${Math.round(line.onTime * 100)}%`}
          </span>
        </div>
      </div>
      {next ? (
        <p className="font-mono text-xs text-muted-foreground">{`下一個截止：${next.label} ${formatStageDeadline(next.deadline, now)}`}</p>
      ) : null}
      {line.stages.map((stage) => {
        const stageSubmissions = line.submissions.filter((s) => s.stage === stage.key);
        return (
          <div
            key={stage.key}
            data-testid={`stage-${stage.key}`}
            className="flex flex-col gap-1 border-t border-[var(--line,#DEE9F8)] pt-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">{stage.label}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {stage.deadline ? formatStageDeadline(stage.deadline, now) : "未設定截止日"}
              </span>
            </div>
            {stageSubmissions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{STAGE_STATE_LABEL[stageState(stage)]}</p>
            ) : (
              <StageReview submissions={stageSubmissions} canReview={canReview} ended={line.light === null} />
            )}
          </div>
        );
      })}
    </div>
  );
}
