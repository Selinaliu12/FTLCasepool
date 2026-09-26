"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { savePeriods } from "@/server/actions/admin";

export type PeriodRow = { date: string; time: string };

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
      const result = await savePeriods(semesterId, rows);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setErrors(result.errors);
      }
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
          {rows.map((row, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-sm text-muted-foreground">第 {i + 1} 期</span>
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
          ))}
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
