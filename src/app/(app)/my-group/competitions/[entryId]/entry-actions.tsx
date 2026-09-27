"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmEntry, withdrawEntry } from "@/server/actions/entries";
import type { EntryDetail } from "@/server/queries/entries";

// 報名頁的主要互動：還沒確認時勾參賽成員＋「確認報名」（確認對話框）；確認過（且沒退出）時
// 顯示已選成員＋「取消報名」（確認對話框，說明檔案與審核紀錄會保留）。
export function EntryActions({ entry, myMemberId }: { entry: EntryDetail; myMemberId: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(
    entry.selectedMemberIds.length > 0 ? entry.selectedMemberIds : myMemberId ? [myMemberId] : []
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((m) => m !== id)));
    setError(null);
  }

  async function onConfirm() {
    setPending(true);
    try {
      const result = await confirmEntry(entry.entryId, selected);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      toast.success("已確認報名");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function onWithdraw() {
    setPending(true);
    try {
      const result = await withdrawEntry(entry.entryId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setWithdrawOpen(false);
      toast.success("已取消報名");
      router.push("/my-group");
    } finally {
      setPending(false);
    }
  }

  if (entry.status === "in_progress" || entry.status === "withdrawn") {
    const selectedStudents = entry.groupStudents.filter((s) => entry.selectedMemberIds.includes(s.id));
    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm text-muted-foreground">參賽成員</p>
          <p className="text-foreground">{selectedStudents.map((s) => s.name).join("、") || "—"}</p>
        </div>
        {entry.status === "in_progress" && (
          <>
            <Button type="button" variant="outline" className="self-start" onClick={() => setWithdrawOpen(true)}>
              取消報名
            </Button>
            <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>確定要取消報名嗎？</DialogTitle>
                  <DialogDescription>
                    取消後這場比賽會標成已退出，之前上傳的檔案與審核紀錄都會保留。取消後可以重新掛這場比賽。
                  </DialogDescription>
                </DialogHeader>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
                    再想想
                  </DialogClose>
                  <Button type="button" variant="destructive" onClick={onWithdraw} disabled={pending}>
                    {pending ? "處理中…" : "確定取消報名"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">參賽成員</p>
        {entry.groupStudents.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(s.id)} onCheckedChange={(v) => toggle(s.id, v === true)} />
            {s.name}
          </label>
        ))}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <Button type="button" className="self-start" onClick={() => setConfirmOpen(true)} disabled={pending}>
        確認報名
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要確認報名嗎？</DialogTitle>
            <DialogDescription>確認後不能再改參賽成員以外的設定。</DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>再想想</DialogClose>
            <Button type="button" onClick={onConfirm} disabled={pending}>
              {pending ? "送出中…" : "確定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
