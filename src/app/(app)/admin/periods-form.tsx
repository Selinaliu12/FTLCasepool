"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewPeriodDeletion, savePeriods, type PeriodDeletionPreview } from "@/server/actions/admin";

// 規格 §14 第 8 點：管理員可以改任何一期（包含已有人交件的期別）的日期、也可以刪除任何一期。
// 刪除有人交件的期別會一併刪掉那些進度與 PDF，所以儲存前先用 previewPeriodDeletion() 查被刪的
// 期別各有幾組交了進度；有的話跳確認視窗，要打「刪除」兩個字才能按確定，確定後帶
// confirmDeleteWithReports: true 儲存。資料庫的 save_periods() 會再檢查一次（沒帶旗標就拒絕）。
export type PeriodRow = {
  id?: string;
  date: string;
  time: string;
  suggestion?: string;
};

const DEFAULT_TIME = "23:59";
const CONFIRM_WORD = "刪除";

export function PeriodsForm({ semesterId, initialRows }: { semesterId: string; initialRows: PeriodRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<PeriodRow[]>(
    initialRows.length > 0 ? initialRows : [{ date: "", time: DEFAULT_TIME }]
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  // 確認視窗：有人交件、這次要被刪的期別（seq 是刪除前的編號）。null＝視窗關著。
  const [pendingDeletion, setPendingDeletion] = useState<PeriodDeletionPreview[] | null>(null);
  const [typed, setTyped] = useState("");

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

  function payload() {
    return rows.map((r) =>
      r.id
        ? {
            id: r.id,
            date: r.date,
            time: r.time,
            suggestion: r.suggestion ?? "",
          }
        : { date: r.date, time: r.time, suggestion: r.suggestion ?? "" }
    );
  }

  async function doSave(confirmDeleteWithReports: boolean) {
    setPending(true);
    setErrors([]);
    setSaved(false);
    try {
      const result = confirmDeleteWithReports
        ? await savePeriods(semesterId, payload(), {
            confirmDeleteWithReports: true,
          })
        : await savePeriods(semesterId, payload());
      setPendingDeletion(null);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setErrors(result.errors);
      }
    } catch (err) {
      setPendingDeletion(null);
      setErrors([err instanceof Error ? err.message : "儲存失敗"]);
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const keptIds = new Set(rows.map((r) => r.id).filter(Boolean));
    const deletedIds = initialRows.map((r) => r.id).filter((id): id is string => !!id && !keptIds.has(id));
    if (deletedIds.length > 0) {
      setPending(true);
      setErrors([]);
      setSaved(false);
      let affected: PeriodDeletionPreview[];
      try {
        affected = (await previewPeriodDeletion(deletedIds)).filter((p) => p.reportCount > 0);
      } catch (err) {
        setErrors([err instanceof Error ? err.message : "儲存失敗"]);
        setPending(false);
        return;
      }
      setPending(false);
      if (affected.length > 0) {
        setTyped("");
        setPendingDeletion(affected);
        return;
      }
    }
    await doSave(false);
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="期別表">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">還沒有任何期別，按下面「新增一期」開始填。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <li key={row.id ?? i} className="flex flex-col gap-2">
                {/* 手機寬：第一行「第 N 期＋刪除」、第二行兩個輸入框各半；sm 以上攤成同一行。 */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center justify-between sm:contents">
                    <span className="w-12 shrink-0 text-sm text-muted-foreground">第 {i + 1} 期</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="sm:order-last"
                      onClick={() => removeRow(i)}
                      aria-label={`刪除第 ${i + 1} 期`}
                    >
                      刪除
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-1">
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
                  </div>
                </div>
                <Textarea
                  aria-label={`第 ${i + 1} 期建議內容（選填）`}
                  placeholder="建議內容（選填）"
                  value={row.suggestion ?? ""}
                  onChange={(e) => updateRow(i, { suggestion: e.target.value })}
                />
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

      <Dialog open={pendingDeletion !== null} onOpenChange={(open) => !open && !pending && setPendingDeletion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要刪除已有人交件的期別嗎？</DialogTitle>
            <DialogDescription render={<div />} className="flex flex-col gap-1 text-[var(--danger)]">
              {(pendingDeletion ?? []).map((p) => (
                <p key={p.periodId}>
                  第 {p.seq} 期有 {p.reportCount} 組交了進度，刪除會一併刪掉這些進度與檔案
                </p>
              ))}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-period-delete" className="text-sm font-medium text-foreground">
              輸入「{CONFIRM_WORD}」確認
            </label>
            <Input
              id="confirm-period-delete"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>取消</DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || typed.trim() !== CONFIRM_WORD}
              onClick={() => void doSave(true)}
            >
              {pending ? "刪除中…" : "確定刪除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
