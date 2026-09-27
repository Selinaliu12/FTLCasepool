"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { attachCompetition } from "@/server/actions/entries";

const UNEXPECTED_ERROR = "操作失敗，請重試";

// 大廳卡片上的「掛到我們組」／「已掛到你們組」按鈕：只有學生（有組）才會看到這顆按鈕
// （page.tsx 只在 isStudent 時才傳這個元件進來）。已經掛過的直接顯示連結，不用再按。
export function AttachCompetitionButton({ competitionId, entryId }: { competitionId: string; entryId: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (entryId) {
    return (
      <Link href={`/my-group/competitions/${entryId}`} className={buttonVariants({ variant: "outline", className: "self-start" })}>
        已掛到你們組
      </Link>
    );
  }

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      const result = await attachCompetition(competitionId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("已掛到你們組");
      router.push(`/my-group/competitions/${result.entryId}`);
    } catch {
      // Final review minor 5：server action 丟出未預期的例外（網路中斷等）時跳 toast，不要靜靜吞掉；
      // 不顯示 err.message——production 的 server action 例外訊息會被遮掉，沒有意義。
      toast.error(UNEXPECTED_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" className="self-start" disabled={pending} onClick={onClick}>
        {pending ? "處理中…" : "掛到我們組"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
