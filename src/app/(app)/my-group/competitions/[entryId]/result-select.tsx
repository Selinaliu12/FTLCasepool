"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { setResult } from "@/server/actions/entries";
import type { EntryResult } from "@/domain/competition-line";

const UNEXPECTED_ERROR = "操作失敗，請重試";

const RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "尚未公布" },
  { value: "advanced", label: "晉級" },
  { value: "awarded", label: "得獎" },
  { value: "not_selected", label: "未入選" },
];

// 只有得獎／未入選會結束這場比賽（晉級還要繼續交決賽、改回尚未公布是還原），所以只有這兩個
// 選項按儲存時需要先跳確認對話框；晉級／尚未公布直接送出。
const NEEDS_CONFIRM = new Set(["awarded", "not_selected"]);

function toResultValue(result: EntryResult): string {
  return result ?? "none";
}

function fromResultValue(value: string): EntryResult {
  return value === "none" ? null : (value as Exclude<EntryResult, null>);
}

// 組頁的「比賽結果」選單：組員可以任意次更正（包含改回尚未公布）。選了得獎／未入選之後按
// 儲存，會先跳出確認對話框說明「這場比賽會結束，之後的階段不用再交」——真正的寫入（setResult）
// 一律等使用者在對話框裡按下確定才送出，取消／再想想不會呼叫 setResult，也不會留下待儲存的
// 選取狀態（選單本身維持使用者剛才選的那個值，方便重按儲存）。
// Final review minor 3（controller ruling）：signupApproved＝報名階段已經通過（已報名）。還沒
// 通過而且結果也還沒填時不顯示選單，只顯示提示（setResult() 也會擋，回「報名通過後才能填比賽
// 結果」）；結果已經有值（舊資料）時仍然顯示選單，讓組員可以清回尚未公布。
export function ResultSelect({
  entryId,
  result,
  signupApproved,
}: {
  entryId: string;
  result: EntryResult;
  signupApproved: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(toResultValue(result));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSave(value: string) {
    setPending(true);
    try {
      const res = await setResult(entryId, fromResultValue(value));
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setError(null);
      setConfirmOpen(false);
      toast.success("已更新比賽結果");
      router.refresh();
    } catch {
      // Final review minor 5：server action 丟出未預期的例外（網路中斷等）時跳 toast，不要靜靜吞掉；
      // 不顯示 err.message——production 的 server action 例外訊息會被遮掉，沒有意義。
      toast.error(UNEXPECTED_ERROR);
    } finally {
      setPending(false);
    }
  }

  if (!signupApproved && result === null) {
    return <p className="text-sm text-muted-foreground">報名階段通過後，才能在這裡填比賽結果。</p>;
  }

  function onSaveClick() {
    setError(null);
    if (NEEDS_CONFIRM.has(selected)) {
      setConfirmOpen(true);
      return;
    }
    void doSave(selected);
  }

  return (
    <div className="flex flex-col gap-3">
      <RadioGroup value={selected} onValueChange={(value) => setSelected(value as string)}>
        {RESULT_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={opt.value} disabled={pending} />
            {opt.label}
          </label>
        ))}
      </RadioGroup>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <Button type="button" className="self-start" onClick={onSaveClick} disabled={pending}>
        {pending ? "儲存中…" : "更新結果"}
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要更新比賽結果嗎？</DialogTitle>
            <DialogDescription>
              填了得獎或未入選後，這場比賽會結束，之後的階段不用再交。確定嗎？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
              再想想
            </DialogClose>
            <Button type="button" onClick={() => doSave(selected)} disabled={pending}>
              {pending ? "送出中…" : "確定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
