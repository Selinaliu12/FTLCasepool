"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setRedAfterHours } from "@/server/actions/admin";

export function SettingsForm({ semesterId, initialHours }: { semesterId: string; initialHours: number }) {
  const router = useRouter();
  const [hours, setHours] = useState(String(initialHours));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const n = Number(hours);
      await setRedAfterHours(semesterId, n);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="燈號門檻">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={720}
          aria-label="逾期超過幾小時轉紅燈"
          value={hours}
          onChange={(e) => {
            setHours(e.target.value);
            setSaved(false);
          }}
          required
        />
        <span className="shrink-0 text-sm text-muted-foreground">小時</span>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-[color:var(--ok)]">已儲存</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "儲存中…" : "儲存"}
      </Button>
    </form>
  );
}
