"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPdfDownloadUrl } from "@/server/actions/download";

// 下載 PDF：跟其他 server action 一樣拿到「預簽 GET 網址」再導頁——瀏覽器看到
// Content-Disposition: attachment 就會直接下載，不用另外處理二進位內容。
export function PdfDownloadButton({ reportId }: { reportId: string }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      const result = await getPdfDownloadUrl(reportId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.location.assign(result.url);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={onClick}>
      {pending ? "準備中…" : "下載 PDF"}
    </Button>
  );
}
