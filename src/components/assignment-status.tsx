import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { submissionTiming, lateBy } from "@/domain/progress";
import { overdueLabel } from "@/domain/lights";

// 一組在一份作業的狀態（§17-10）：已交（準時／逾期 N 天）、未交、逾期未交。
// /assignments 清單、/my-group、/groups/[id] 共用；顏色照 PRODUCT.md 的狀態色。
export function AssignmentStatus({ deadline, submittedAt, now }: { deadline: Date; submittedAt: Date | null; now: Date }) {
  if (submittedAt) {
    const t = submissionTiming(deadline, submittedAt);
    return (
      <Badge
        variant="outline"
        className={cn("border-transparent", t.late ? "bg-[var(--warn)]/10 text-[var(--warn)]" : "bg-[var(--ok)]/10 text-[var(--ok)]")}
      >
        已交 · {t.label}
      </Badge>
    );
  }
  const overdue = lateBy(deadline, now);
  if (overdue.late) {
    return (
      <Badge variant="outline" className="border-transparent bg-[var(--danger,#B3261E)]/10 text-[var(--danger,#B3261E)]">
        未交 · {overdueLabel(overdue.hours)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      未交
    </Badge>
  );
}
