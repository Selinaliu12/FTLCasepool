import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { submissionTiming } from "@/domain/progress";

// 已交期別的「準時／逾期 N 天」標記（規格 §4.4、§4.5）。/my-group 的期別卡與單期報告頁共用。
// 日期可以傳 ISO 字串，讓 server component 跟 client component（EditableReport）都能直接用。
// 顏色照 PRODUCT.md 的狀態色：文字用 --ok／--warn，底色用同色 10%。
export function SubmissionTiming({ deadline, submittedAt }: { deadline: string | Date; submittedAt: string | Date }) {
  const t = submissionTiming(new Date(deadline), new Date(submittedAt));
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        t.late ? "bg-[var(--warn)]/10 text-[var(--warn)]" : "bg-[var(--ok)]/10 text-[var(--ok)]"
      )}
    >
      {t.label}
    </Badge>
  );
}
