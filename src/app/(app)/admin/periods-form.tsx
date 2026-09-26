"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { savePeriods } from "@/server/actions/admin";
import { formatTaipei, parseTaipeiDeadline } from "@/domain/time";

// readOnly：這一期已經凍結（已有人交件，或排在已有人交件的期別之前——改它會讓凍結期別的編號位移），
// 畫面上只顯示、不能改或刪。hasReports：真的有組別交了這一期，旁邊標「已有人交件」。
// 規則的最終判定在資料庫的 save_periods()，這裡只是讓管理員一眼看出哪些不能動。
export type PeriodRow = { id?: string; date: string; time: string; readOnly?: boolean; hasReports?: boolean };

function displayDeadline(row: PeriodRow): string {
  try {
    return formatTaipei(parseTaipeiDeadline(row.date, row.time));
  } catch {
    return `${row.date} ${row.time}`;
  }
}

const DEFAULT_TIME = "23:59";

export function PeriodsForm({ semesterId, initialRows }: { semesterId: string; initialRows: PeriodRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<PeriodRow[]>(initialRows.length > 0 ? initialRows : [{ date: "", time: DEFAULT_TIME }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  function addRow() {
    setRows((r) => [...r, { date: "", time: DEFAULT_TIME }]);
    setSaved(false);
  }

  function updateRow(i: number, patch: Partial<PeriodRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setSaved(false);
  }

  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrors([]);
    setSaved(false);
    try {
      const result = await savePeriods(
        semesterId,
        rows.map((r) => (r.id ? { id: r.id, date: r.date, time: r.time } : { date: r.date, time: r.time }))
      );
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setErrors(result.errors);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "儲存失敗"]);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="期別表">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">還沒有任何期別，按下面「新增一期」開始填。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, i) =>
            row.readOnly ? (
              <li key={row.id ?? i} className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="w-12 shrink-0 text-sm text-muted-foreground">第 {i + 1} 期</span>
                <span className="font-mono text-sm text-foreground">{displayDeadline(row)}</span>
                {row.hasReports && <Badge variant="secondary">已有人交件</Badge>}
              </li>
            ) : (
              <li key={row.id ?? i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-sm text-muted-foreground">第 {i + 1} 期</span>
                <Input
                  type="date"
                  aria-label={`第 ${i + 1} 期日期`}
                  value={row.date}
                  onChange={(e) => updateRow(i, { date: e.target.value })}
                  required
                />
                <Input
                  type="time"
                  aria-label={`第 ${i + 1} 期時間`}
                  value={row.time}
                  onChange={(e) => updateRow(i, { time: e.target.value })}
                  required
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(i)} aria-label={`刪除第 ${i + 1} 期`}>
                  刪除
                </Button>
              </li>
            )
          )}
        </ul>
      )}

      <Button type="button" variant="outline" onClick={addRow}>
        新增一期
      </Button>

      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-sm text-destructive">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {saved && <p className="text-sm text-[color:var(--ok)]">已儲存</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "儲存中…" : "儲存期別"}
      </Button>
    </form>
  );
}
