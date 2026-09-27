"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { reviewStage } from "@/server/actions/stages";
import { getStagePdfDownloadUrl } from "@/server/actions/download";
import type { StageSubmissionDetail } from "@/server/queries/competition-lines";
import type { ReviewStatus } from "@/domain/competition-line";

const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "待審",
  approved: "已通過",
  returned: "已退回",
};

// 組頁的比賽線審核區：每一版顯示版本／狀態／評語／下載按鈕；最新一版如果已鎖定、還在
// pending、線還沒結束，且看的人是 PM，才顯示通過／退回按鈕（canReview 由呼叫端依
// pm_assignments 決定，跟 reviewStage() 的權限檢查同一份資料來源——這裡只是不讓沒被指派的 PM
// 看到按鈕，真正的授權還是 server action 自己做，按下去才會真的檢查一次）。
//
// fix round 1 Minor 4（controller ruling）：ended（線已經結束——已退出／未入選／得獎）時
// 一律不顯示這兩個按鈕，即使剛好還留著一筆鎖定、pending 的版本（reviewStage() 本來就會用
// REVIEW_ENDED 擋下這個動作，但按鈕沒有先藏起來的話，PM 會點了才發現不能用）。呼叫端
// （/groups/[groupId]）用 line.light === null 判斷 ended——competitionLineDisplay() 對結束的線
// 一律回傳 light: null（見 domain/competition-line.ts），跟「目前沒有欠交、燈是綠色」不是
// 同一件事。
export function StageReview({
  submissions,
  canReview,
  ended,
}: {
  submissions: StageSubmissionDetail[];
  canReview: boolean;
  ended: boolean;
}) {
  if (submissions.length === 0) return null;

  const latest = submissions[submissions.length - 1];
  const showActions = !ended && canReview && latest.reviewStatus === "pending" && latest.locked;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 text-sm">
        {submissions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">
              第 {s.version} 版 · {formatTaipei(s.pdfUploadedAt)}
            </span>
            <Badge variant="secondary">{REVIEW_STATUS_LABEL[s.reviewStatus]}</Badge>
            <DownloadButton submissionId={s.id} />
            {/* Final review minor 1：通過也可以附評語，通過／退回的評語都顯示。 */}
            {s.reviewStatus !== "pending" && s.comment && (
              <span className="text-muted-foreground">（{s.comment}）</span>
            )}
          </li>
        ))}
      </ul>
      {showActions && <ReviewActions submissionId={latest.id} />}
    </div>
  );
}

function DownloadButton({ submissionId }: { submissionId: string }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      const result = await getStagePdfDownloadUrl(submissionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.location.assign(result.url);
    } catch {
      toast.error("下載失敗，請再試一次");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClick}>
      {pending ? "準備中…" : "下載 PDF"}
    </Button>
  );
}

function ReviewActions({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [returnOpen, setReturnOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [approveComment, setApproveComment] = useState("");
  const [pending, setPending] = useState(false);

  // Final review minor 1：通過可以附選填評語（review_stage() 本來就會存 comment，空白存成
  // null）。留空就送 null。
  async function onApprove() {
    setPending(true);
    try {
      const trimmed = approveComment.trim();
      const result = await reviewStage(submissionId, "approved", trimmed === "" ? null : trimmed);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("已通過");
      setApproveOpen(false);
      setApproveComment("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失敗，請重試");
    } finally {
      setPending(false);
    }
  }

  async function onReturn() {
    setPending(true);
    try {
      const result = await reviewStage(submissionId, "returned", comment);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("已退回");
      setReturnOpen(false);
      setComment("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失敗，請重試");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Button type="button" disabled={pending} onClick={() => setApproveOpen(true)}>
        通過
      </Button>
      <Button type="button" variant="destructive" disabled={pending} onClick={() => setReturnOpen(true)}>
        退回
      </Button>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>通過這一版</DialogTitle>
            <DialogDescription>可以留一句評語給組員（選填），組員會在報名頁看到。</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="通過評語（選填）"
            value={approveComment}
            onChange={(e) => setApproveComment(e.target.value)}
            placeholder="評語（選填）"
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>取消</DialogClose>
            <Button type="button" disabled={pending} onClick={onApprove}>
              {pending ? "送出中…" : "確定通過"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退回原因</DialogTitle>
            <DialogDescription>請寫清楚要重交的原因，組員會在報名頁看到這段文字。</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="退回原因"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="退回原因"
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={pending} />}>取消</DialogClose>
            <Button type="button" variant="destructive" disabled={pending || comment.trim() === ""} onClick={onReturn}>
              {pending ? "送出中…" : "確定退回"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
