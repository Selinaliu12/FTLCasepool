"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { SubmissionTiming } from "@/components/submission-timing";
import { PdfDownloadButton } from "@/components/pdf-download-button";
import { formatTaipei } from "@/domain/time";
import { validatePdfMeta } from "@/domain/pdf";
import { validateSubmissionNote } from "@/domain/assignment";
import { putWithProgress } from "../../periods/[periodId]/report-shared";
import { requestPdfUpload } from "@/server/actions/upload";
import { submitAssignment, editAssignmentNote, replaceAssignmentPdf, withdrawAssignment } from "@/server/actions/assignments";
import { markSubmittedToast } from "../../submitted-toast";

// 作業繳交（規格 §17-4、5）：1 份 PDF＋選填說明。規則同雙週進度：交出後 2 小時內可以改說明、換 PDF
// （換 PDF 會更新繳交時間）、撤回整份；之後鎖定唯讀。

async function uploadPdf(file: File, onProgress: (n: number) => void): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const upload = await requestPdfUpload({ name: file.name, type: file.type, size: file.size });
  if (!upload.ok) return upload;
  await putWithProgress(upload.url, file, onProgress);
  return { ok: true, key: upload.key };
}

export function NewAssignmentSubmission({ assignmentId }: { assignmentId: string }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(null);
    setError(null);
    if (!f) return;
    const meta = validatePdfMeta({ name: f.name, type: f.type, size: f.size });
    if (!meta.ok) return setError(meta.error);
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (uploading) return;
    if (!file) return setError("請附上 PDF");
    const v = validateSubmissionNote(note);
    if (!v.ok) return setError(v.error);
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const up = await uploadPdf(file, setProgress);
      if (!up.ok) {
        setError(up.error);
        setUploading(false);
        return;
      }
      const r = await submitAssignment(assignmentId, { note, pdfKey: up.key });
      if (!r.ok) {
        setError(r.error);
        setUploading(false);
        return;
      }
      // 同雙週進度：整頁載入回組頁再跳「已送出」提示（見 progress-form.tsx 的註解）。
      markSubmittedToast();
      window.location.assign("/my-group");
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗，請重試");
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" aria-label="交作業">
      <div className="flex flex-col gap-1">
        <label htmlFor="assignment-pdf" className="text-sm font-medium">
          PDF
        </label>
        <input id="assignment-pdf" type="file" accept="application/pdf" disabled={uploading} onChange={onFileChange} />
        {file && <p className="text-sm text-muted-foreground">已選擇：{file.name}</p>}
        {uploading && <p className="text-sm text-muted-foreground">上傳中… {progress}%</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="assignment-note" className="text-sm font-medium">
          說明（選填）
        </label>
        <Textarea id="assignment-note" value={note} disabled={uploading} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="text-sm text-[color:var(--warn,#8A5300)]">⚠️ 替換檔案後，繳交時間以新檔案為準。</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={uploading}>
        {uploading ? "上傳中…" : "送出"}
      </Button>
    </form>
  );
}

export function EditableAssignmentSubmission(props: {
  submissionId: string;
  note: string | null;
  submittedBy: string;
  submittedAt: string; // ISO
  lockedAt: string; // ISO
  deadline: string; // ISO
  locked: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(props.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [lateConfirmOpen, setLateConfirmOpen] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "操作失敗，請再試一次");
      after?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗，請再試一次");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function replace(file: File) {
    void run(async () => {
      setProgress(0);
      const up = await uploadPdf(file, setProgress);
      if (!up.ok) return up;
      const r = await replaceAssignmentPdf(props.submissionId, up.key);
      if (r.ok) toast.success(r.becameLate ? "已換檔，這份作業已變成逾期繳交" : "已換檔");
      return r;
    });
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    const meta = validatePdfMeta({ name: f.name, type: f.type, size: f.size });
    if (!meta.ok) return setError(meta.error);
    // 原本準時、現在已過截止：換檔會變成逾期，先確認（同雙週進度）。
    const wasOnTime = new Date(props.submittedAt).getTime() <= new Date(props.deadline).getTime();
    if (wasOnTime && Date.now() > new Date(props.deadline).getTime()) {
      pendingFileRef.current = f;
      setLateConfirmOpen(true);
      return;
    }
    replace(f);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        <span>
          已交 · {props.submittedBy} · {formatTaipei(new Date(props.submittedAt))}
        </span>
        <SubmissionTiming deadline={props.deadline} submittedAt={props.submittedAt} />
      </div>
      <p className="text-xs text-muted-foreground">
        {props.locked ? "已鎖定，不能再修改" : `${formatTaipei(new Date(props.lockedAt))} 前可以修改、換檔或撤回`}
      </p>

      {editing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="assignment-note-edit" className="text-sm font-medium">
            說明（選填）
          </label>
          <Textarea id="assignment-note-edit" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => editAssignmentNote(props.submissionId, note), () => setEditing(false))}
            >
              {busy ? "儲存中…" : "儲存"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => (setNote(props.note ?? ""), setEditing(false))}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-foreground">說明</p>
          <p className="whitespace-pre-wrap break-words text-muted-foreground">{props.note ?? "（沒有填）"}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <PdfDownloadButton assignmentSubmissionId={props.submissionId} />
        {!props.locked && !editing ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              改說明
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              {progress !== null ? `上傳中… ${progress}%` : "換 PDF"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setWithdrawOpen(true)}>
              撤回
            </Button>
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" aria-label="選擇新的 PDF" onChange={onPickFile} />
          </>
        ) : null}
      </div>
      {!props.locked && <p className="text-sm text-[color:var(--warn,#8A5300)]">⚠️ 替換檔案後，繳交時間以新檔案為準。</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要撤回這份作業嗎？</DialogTitle>
            <DialogDescription>撤回後 PDF 與說明都會被刪除，不會留下紀錄，這份作業會回到未交。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>取消</DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void run(() => withdrawAssignment(props.submissionId), () => setWithdrawOpen(false))}
            >
              {busy ? "撤回中…" : "確定撤回"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lateConfirmOpen} onOpenChange={setLateConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要換檔嗎？</DialogTitle>
            <DialogDescription>已經過了截止時間，換檔後這份作業會變成逾期繳交。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
            <Button
              type="button"
              onClick={() => {
                setLateConfirmOpen(false);
                if (pendingFileRef.current) replace(pendingFileRef.current);
                pendingFileRef.current = null;
              }}
            >
              確定換檔
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
