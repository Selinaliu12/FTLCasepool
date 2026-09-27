"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTaipei } from "@/domain/time";
import { lockedAt } from "@/domain/lock";
import { validatePdfMeta } from "@/domain/pdf";
import type { Stage, ReviewStatus } from "@/domain/competition-line";
import type { StageSubmission } from "@/server/queries/entries";
import { putWithProgress } from "../../periods/[periodId]/report-shared";
import { requestPdfUpload } from "@/server/actions/upload";
import { submitStage, replaceStagePdf, withdrawStage } from "@/server/actions/stages";

const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "待審",
  approved: "已通過",
  returned: "已退回",
};

// 組頁報名頁的三個階段上傳區塊：報名／繳件／決賽。每個階段各自獨立（哪個階段可以上傳、
// 換檔、撤回都只看那個階段自己的 latest 版本），共用同一套上傳安全鏈（requestPdfUpload →
// putWithProgress → submitStage／replaceStagePdf，跟 editable-report.tsx 同一套）。
export function StageUploads({
  entryId,
  stages,
  submissions,
  ended,
}: {
  entryId: string;
  stages: Stage[];
  submissions: StageSubmission[];
  ended: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {stages.map((stage) => (
        <StageCard
          key={stage.key}
          entryId={entryId}
          stage={stage}
          submissions={submissions.filter((s) => s.stage === stage.key)}
          ended={ended}
        />
      ))}
    </div>
  );
}

function StageCard({
  entryId,
  stage,
  submissions,
  ended,
}: {
  entryId: string;
  stage: Stage;
  submissions: StageSubmission[];
  ended: boolean;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const active = stage.latest && stage.latest.status !== "returned" ? stage.latest : null;
  const activeSubmission = active
    ? submissions.find((s) => s.version === active.version) ?? null
    : null;
  const canUpload = !ended && (stage.latest === null || stage.latest.status === "returned");

  async function doSubmit(file: File) {
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const upload = await requestPdfUpload({ name: file.name, type: file.type, size: file.size });
      if (!upload.ok) {
        setError(upload.error);
        return;
      }
      await putWithProgress(upload.url, file, setProgress);
      const result = await submitStage(entryId, stage.key, upload.key);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`已上傳${stage.label}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗，請重試");
    } finally {
      setUploading(false);
    }
  }

  async function doReplace(file: File) {
    if (!activeSubmission) return;
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const upload = await requestPdfUpload({ name: file.name, type: file.type, size: file.size });
      if (!upload.ok) {
        setError(upload.error);
        return;
      }
      await putWithProgress(upload.url, file, setProgress);
      const result = await replaceStagePdf(activeSubmission.id, upload.key);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("已換檔");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗，請重試");
    } finally {
      setUploading(false);
    }
  }

  function onPickForSubmit(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    const meta = validatePdfMeta({ name: f.name, type: f.type, size: f.size });
    if (!meta.ok) {
      setError(meta.error);
      return;
    }
    void doSubmit(f);
  }

  function onPickForReplace(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    const meta = validatePdfMeta({ name: f.name, type: f.type, size: f.size });
    if (!meta.ok) {
      setError(meta.error);
      return;
    }
    void doReplace(f);
  }

  async function onWithdraw() {
    if (!activeSubmission) return;
    setWithdrawing(true);
    try {
      const result = await withdrawStage(activeSubmission.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("已撤回");
      router.refresh();
    } catch (err) {
      // fix round 1（controller ruling 9）：withdrawStage() 本身丟出未預期的例外（網路中斷、
      // 資料庫暫時打不通等）不該讓使用者看起來像什麼都沒發生——跟 doSubmit／doReplace 的
      // catch 一樣，用一句訊息告訴使用者，不是靜靜吞掉。
      toast.error(err instanceof Error ? err.message : "撤回失敗，請重試");
    } finally {
      setWithdrawing(false);
      setWithdrawOpen(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base font-medium">
          <span>{stage.label}</span>
          {stage.deadline && <span className="text-sm font-normal text-muted-foreground">截止 {formatTaipei(stage.deadline)}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {active && activeSubmission && (
          <>
            {active.locked ? (
              active.status === "pending" ? (
                <p className="text-sm font-medium text-foreground">已鎖定，等待審核</p>
              ) : (
                <p className="text-sm font-medium text-foreground">已通過審核</p>
              )
            ) : (
              <>
                <p className="text-sm text-foreground">
                  已上傳第 {active.version} 版 · {REVIEW_STATUS_LABEL[active.status]} · 可修改到{" "}
                  {formatTaipei(lockedAt(new Date(activeSubmission.pdfUploadedAt)))}
                </p>
                {/* controller ruling 6（fix round 1）：線已結束時，換 PDF 會被 replaceStagePdf
                    擋下來（ENDED_ERROR）——不顯示這個按鈕，不讓使用者點了才發現不能用；撤回仍然
                    允許（withdrawStage 對已結束的線不擋 pending、還沒鎖定的版本），按鈕留著。 */}
                {!ended && <p className="text-sm text-[color:var(--warn,#8A5300)]">⚠️ 替換檔案後，繳交時間以新檔案為準。</p>}
                <div className="flex flex-wrap gap-2">
                  {!ended && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => replaceInputRef.current?.click()}
                    >
                      換 PDF
                    </Button>
                  )}
                  <Button type="button" variant="destructive" disabled={uploading} onClick={() => setWithdrawOpen(true)}>
                    撤回
                  </Button>
                  {!ended && (
                    <input
                      ref={replaceInputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={onPickForReplace}
                      aria-label={`${stage.label} 換 PDF`}
                    />
                  )}
                </div>
              </>
            )}
          </>
        )}

        {canUpload && (
          <>
            <p className="text-sm text-[color:var(--warn,#8A5300)]">⚠️ 替換檔案後，繳交時間以新檔案為準。</p>
            <div>
              <Button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                上傳
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={onPickForSubmit}
                aria-label={`上傳${stage.label}`}
              />
            </div>
          </>
        )}

        {ended && !active && <p className="text-sm text-muted-foreground">這場比賽已經結束</p>}

        {uploading && <p className="text-sm text-muted-foreground">上傳中… {progress}%</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {submissions.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {submissions.map((s) => (
              <li key={s.id}>
                第 {s.version} 版 · {REVIEW_STATUS_LABEL[s.reviewStatus]} · {formatTaipei(new Date(s.pdfUploadedAt))}
                {s.comment && s.reviewStatus === "returned" ? `（${s.comment}）` : ""}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要撤回{stage.label}嗎？</DialogTitle>
            <DialogDescription>撤回後這一版跟 PDF 都會被刪除，不會留下紀錄，也不算版本。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={withdrawing} />}>取消</DialogClose>
            <Button type="button" variant="destructive" disabled={withdrawing} onClick={onWithdraw}>
              {withdrawing ? "撤回中…" : "確定撤回"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
