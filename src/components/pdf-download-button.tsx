"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPdfDownloadUrl, getAssignmentPdfDownloadUrl } from "@/server/actions/download";

// 下載 PDF：跟其他 server action 一樣拿到「預簽 GET 網址」再導頁——瀏覽器看到
// Content-Disposition: attachment 就會直接下載，不用另外處理二進位內容。
// 雙週進度傳 reportId；作業繳交（§17）傳 assignmentSubmissionId。
export function PdfDownloadButton(props: { reportId: string } | { assignmentSubmissionId: string }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      const result =
        "reportId" in props ? await getPdfDownloadUrl(props.reportId) : await getAssignmentPdfDownloadUrl(props.assignmentSubmissionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.location.assign(result.url);
    } catch {
      // server action 本身丟出未預期的例外（網路中斷、R2／資料庫暫時打不通等）：跟
      // "ok: false" 那種「找不到這份進度」分開處理，用一句通用訊息，不把內部錯誤細節
      // 顯示給使用者。
      toast.error("下載失敗，請再試一次");
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
