import { LIGHT_LABEL } from "@/domain/lights";
import type { CheckinHistoryEntry } from "@/domain/checkin-history";
import { formatTaipei } from "@/domain/time";

// 中間週燈號歷程：/groups/[groupId]（幹部／管理員視角）與 /my-group（學生自己組）共用同一段
// 畫面，原本各自重複貼了一份一模一樣的 JSX，抽成這個共用元件。
export function CheckinHistory({ checkins }: { checkins: CheckinHistoryEntry[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-lg font-bold text-foreground">中間週燈號歷程</h2>
      {checkins.length === 0 ? (
        <p className="text-sm text-muted-foreground">還沒有組員點燈</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {checkins.map((c, i) => (
            <li key={i} className="flex flex-col gap-1 rounded-[var(--r-sm,12px)] border border-[var(--line,#DEE9F8)] p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{LIGHT_LABEL[c.light]}</span>
                <span className="text-muted-foreground">
                  {c.by} · {formatTaipei(c.at)}
                </span>
              </div>
              {c.note ? <p className="text-sm text-muted-foreground">{c.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
