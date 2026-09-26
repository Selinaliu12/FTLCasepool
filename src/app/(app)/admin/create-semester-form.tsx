"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createSemester } from "@/server/actions/admin";

// 已經有當前學期時，建立新學期會把舊學期設成非當前：舊學期名單上的所有人從此都登不進來，
// 網站上也沒有「切回舊學期」的功能。所以：
//   - 表單收在「開始新學期…」後面，不直接攤在管理頁上；
//   - 送出前跳確認視窗，寫清楚後果，並要求再打一次新學期名稱，「確定建立」才按得下去。
// 還沒有任何學期（第一次建立）時沒有人會被鎖在外面，維持直接建立。
export function CreateSemesterForm({ currentSemesterName }: { currentSemesterName: string | null }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function doCreate() {
    setPending(true);
    setError(null);
    try {
      await createSemester(trimmed);
      setName("");
      setTyped("");
      setConfirmOpen(false);
      setExpanded(false);
      router.refresh();
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    if (currentSemesterName) {
      setTyped("");
      setConfirmOpen(true);
      return;
    }
    void doCreate();
  }

  if (currentSemesterName && !expanded) {
    return (
      <Button type="button" variant="outline" className="w-fit" onClick={() => setExpanded(true)}>
        開始新學期…
      </Button>
    );
  }

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="建立學期">
        <Input
          aria-label="學期名稱"
          placeholder="例如 115-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || !trimmed}>
            {pending ? "建立中…" : "建立學期"}
          </Button>
          {currentSemesterName && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setExpanded(false);
                setName("");
                setError(null);
              }}
            >
              取消
            </Button>
          )}
        </div>
      </form>

      {currentSemesterName && (
        <Dialog open={confirmOpen} onOpenChange={(open) => !pending && setConfirmOpen(open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>確定要開始新學期「{trimmed}」嗎？</DialogTitle>
              <DialogDescription className="text-[var(--danger)]">
                建立新學期後，目前學期「{currentSemesterName}」的所有成員都無法再登入，這個動作無法從網站復原。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirm-semester-name" className="text-sm font-medium text-foreground">
                再輸入一次新學期名稱
              </label>
              <Input
                id="confirm-semester-name"
                autoComplete="off"
                placeholder={trimmed}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={pending} />}>取消</DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || typed.trim() !== trimmed}
                onClick={() => void doCreate()}
              >
                {pending ? "建立中…" : "確定建立"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
