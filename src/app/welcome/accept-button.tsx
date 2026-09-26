"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { acknowledge } from "@/server/actions/acknowledge";

export function AcceptButton() {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await acknowledge();
    } catch {
      // acknowledge() 成功時用 redirect() 導頁，Next.js 會把它當成導航處理，不會走到這裡；
      // 只有真的失敗（例如網路問題）才會落到這裡，讓按鈕恢復可按狀態。
      setPending(false);
    }
  }

  return (
    <Button size="lg" className="h-11 w-full text-base" onClick={onClick} disabled={pending}>
      {pending ? "確認中…" : "我已了解"}
    </Button>
  );
}
