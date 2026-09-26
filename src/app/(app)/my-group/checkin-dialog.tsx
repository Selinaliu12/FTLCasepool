"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateCheckin } from "@/domain/progress";
import { LIGHT_LABEL, type Light } from "@/domain/lights";
import { submitCheckin } from "@/server/actions/checkin";

const LIGHT_OPTIONS: { value: Light; dotClass: string }[] = [
  { value: "green", dotClass: "bg-[var(--ok)]" },
  { value: "yellow", dotClass: "bg-[var(--warn)]" },
  { value: "red", dotClass: "bg-[var(--danger)]" },
];

// 中間週點燈號：任何組員都可以點，沒有截止日、選填。紅燈才需要多補一句「卡在哪裡」——
// 跟交進度頁（progress-form.tsx）的燈號選擇器同一套視覺語言，但這裡是彈窗、欄位更少。
export function CheckinDialog() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [light, setLight] = useState<Light | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setLight(null);
    setNote("");
    setError(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function onSubmit() {
    const validation = validateCheckin({ light, note });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await submitCheckin({ light: light!, note });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      toast.success("已記錄這週燈號");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        點一下這週燈號
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>這週燈號</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2">
            {LIGHT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-label={LIGHT_LABEL[opt.value]}
                aria-pressed={light === opt.value}
                disabled={pending}
                onClick={() => {
                  setLight(opt.value);
                  setError(null);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-[var(--r-sm,12px)] border p-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                  light === opt.value ? "border-primary bg-primary/10" : "border-[var(--line,#DEE9F8)]"
                )}
              >
                <span className={cn("size-6 rounded-full", opt.dotClass)} aria-hidden="true" />
                <span className="font-medium">{LIGHT_LABEL[opt.value]}</span>
              </button>
            ))}
          </div>

          {light === "red" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="checkin-note" className="text-sm font-medium">
                卡在哪裡
              </label>
              <Textarea
                id="checkin-note"
                value={note}
                disabled={pending}
                onChange={(e) => {
                  setNote(e.target.value);
                  setError(null);
                }}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>取消</DialogClose>
            <Button type="button" onClick={onSubmit} disabled={pending}>
              {pending ? "送出中…" : "送出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
