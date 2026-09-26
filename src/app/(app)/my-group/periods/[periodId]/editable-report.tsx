"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "cn";
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
import { LightBadge } from "@/components/light-badge";
import { SubmissionTiming } from "@/components/submission-timing";
import { formatTaipei } from "@/domain/time";
import { validateProgress } from "@/domain/progress";
import { validatePdfMeta } from "@/domain/pdf";
import type { Light } from "@/domain/lights";
import { LIGHT_OPTIONS, putWithProgress } from "./report-shared";
import { requestPdfUpload } from "@/server/actions/upload";
import { editProgress, replaceProgressPdf, withdrawProgress } from "@/server/actions/progress";

export function EditableReport(props: {
  reportId: string;
  light: Light;
  did: string;
  blocked: string;
  nextSteps: string;
  submittedBy: string;
  submittedAt: string; // ISO
  lockedAt: string; // ISO
  deadline: string; // ISO
  locked: boolean;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [light, setLight] = useState<Light>(props.light);
  const [did, setDid] = useState(props.did);
  const [blocked, setBlocked] = useState(props.blocked);
  const [nextSteps, setNextSteps] = useState(props.nextSteps);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const [lateConfirmOpen, setLateConfirmOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState(0);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const pendingFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onSaveEdit() {
    const validation = validateProgress({ light, did, blocked, nextSteps, hasPdf: true });
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    setSaveError(null);
    setSaving(true);
    try {
      const result = await editProgress(props.reportId, { light, did, blocked, nextSteps });
      if (!result.ok) {
        setSaveError(result.error);
        return;
      }
      setMode("view");
      router.refresh();
    } finally {
      // try/finally（fix round 1）：不管上面是正常回傳、提早 return、還是 editProgress()
      // 本身丟出例外，saving 一定要被重設，不然按鈕會永遠卡在「儲存中…」。
      setSaving(false);
    }
  }

  function onCancelEdit() {
    setLight(props.light);
    setDid(props.did);
    setBlocked(props.blocked);
    setNextSteps(props.nextSteps);
    setErrors({});
    setSaveError(null);
    setMode("view");
  }

  async function doReplace(file: File) {
    setReplaceError(null);
    setReplacing(true);
    setReplaceProgress(0);
    try {
      const upload = await requestPdfUpload({ name: file.name, type: file.type, size: file.size });
      if (!upload.ok) {
        setReplaceError(upload.error);
        setReplacing(false);
        return;
      }
      await putWithProgress(upload.url, file, setReplaceProgress);
      const result = await replaceProgressPdf(props.reportId, upload.key);
      if (!result.ok) {
        setReplaceError(result.error);
        setReplacing(false);
        return;
      }
      toast.success(result.becameLate ? "已換檔，這期已變成逾期繳交" : "已換檔");
      router.refresh();
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : "上傳失敗，請重試");
    } finally {
      setReplacing(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    const meta = validatePdfMeta({ name: f.name, type: f.type, size: f.size });
    if (!meta.ok) {
      setReplaceError(meta.error);
      return;
    }

    const now = new Date();
    const deadline = new Date(props.deadline);
    const submittedAt = new Date(props.submittedAt);
    const wasOnTime = submittedAt.getTime() <= deadline.getTime();
    const nowOverdue = now.getTime() > deadline.getTime();

    if (wasOnTime && nowOverdue) {
      pendingFileRef.current = f;
      setLateConfirmOpen(true);
      return;
    }

    void doReplace(f);
  }

  async function onConfirmLateReplace() {
    setLateConfirmOpen(false);
    const f = pendingFileRef.current;
    pendingFileRef.current = null;
    if (f) await doReplace(f);
  }

  async function onWithdraw() {
    setWithdrawing(true);
    try {
      const result = await withdrawProgress(props.reportId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push("/my-group");
    } finally {
      // try/finally（fix round 1）：跟 onSaveEdit 一樣，withdrawing 一定要被重設，
      // 不管是正常回傳、提早 return、還是 withdrawProgress() 丟出例外。
      setWithdrawing(false);
      setWithdrawOpen(false);
    }
  }

  if (props.locked) {
    return (
      <div className="flex flex-col gap-4">
        <LightBadge light={props.light} source="組員回報" />
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>
            已交 · {props.submittedBy} · {formatTaipei(new Date(props.submittedAt))}
          </span>
          <SubmissionTiming deadline={props.deadline} submittedAt={props.submittedAt} />
        </p>
        <p className="text-sm font-medium text-foreground">已鎖定</p>
        <ReadonlyFields did={props.did} blocked={props.blocked} nextSteps={props.nextSteps} />
        <ReplaceWarning />
      </div>
    );
  }

  if (mode === "edit") {
    return (
      <div className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">燈號</legend>
          <div className="grid grid-cols-3 gap-2">
            {LIGHT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-label={opt.label}
                aria-pressed={light === opt.value}
                disabled={saving}
                onClick={() => setLight(opt.value)}
                className={cn(
                  "flex items-center justify-center rounded-[var(--r-sm,12px)] border p-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                  light === opt.value ? "border-primary bg-primary/10" : "border-[var(--line,#DEE9F8)]"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {errors.light && (
            <p role="alert" className="text-sm text-destructive">
              {errors.light}
            </p>
          )}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor="edit-did" className="text-sm font-medium">
            這兩週做了什麼
          </label>
          <Textarea id="edit-did" value={did} disabled={saving} onChange={(e) => setDid(e.target.value)} />
          {errors.did && (
            <p role="alert" className="text-sm text-destructive">
              {errors.did}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="edit-blocked" className="text-sm font-medium">
            卡在哪裡
          </label>
          <Textarea id="edit-blocked" value={blocked} disabled={saving} onChange={(e) => setBlocked(e.target.value)} />
          {errors.blocked && (
            <p role="alert" className="text-sm text-destructive">
              {errors.blocked}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="edit-next-steps" className="text-sm font-medium">
            接下來要做什麼
          </label>
          <Textarea
            id="edit-next-steps"
            value={nextSteps}
            disabled={saving}
            onChange={(e) => setNextSteps(e.target.value)}
          />
          {errors.nextSteps && (
            <p role="alert" className="text-sm text-destructive">
              {errors.nextSteps}
            </p>
          )}
        </div>

        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        )}

        <ReplaceWarning />

        <div className="flex gap-2">
          <Button type="button" onClick={onSaveEdit} disabled={saving}>
            {saving ? "儲存中…" : "儲存"}
          </Button>
          <Button type="button" variant="outline" onClick={onCancelEdit} disabled={saving}>
            取消
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <LightBadge light={props.light} source="組員回報" />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>
          已交 · {props.submittedBy} · {formatTaipei(new Date(props.submittedAt))}
        </span>
        <SubmissionTiming deadline={props.deadline} submittedAt={props.submittedAt} />
      </p>
      <p className="text-sm text-foreground">可修改到 {formatTaipei(new Date(props.lockedAt))}</p>

      <ReadonlyFields did={props.did} blocked={props.blocked} nextSteps={props.nextSteps} />

      <ReplaceWarning />

      {replaceError && (
        <p role="alert" className="text-sm text-destructive">
          {replaceError}
        </p>
      )}
      {replacing && <p className="text-sm text-muted-foreground">上傳中… {replaceProgress}%</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setMode("edit")} disabled={replacing}>
          修改
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={replacing}
          onClick={() => fileInputRef.current?.click()}
        >
          換 PDF
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onPickFile}
          aria-label="換 PDF"
        />
        <Button type="button" variant="destructive" disabled={replacing} onClick={() => setWithdrawOpen(true)}>
          撤回
        </Button>
      </div>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要撤回這一期嗎？</DialogTitle>
            <DialogDescription>撤回後這一筆報告跟 PDF 都會被刪除，不會留下紀錄，這一期會回到未交。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={withdrawing} />}>取消</DialogClose>
            <Button type="button" variant="destructive" disabled={withdrawing} onClick={onWithdraw}>
              {withdrawing ? "撤回中…" : "確定撤回"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lateConfirmOpen} onOpenChange={setLateConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要換檔嗎？</DialogTitle>
            <DialogDescription>現在換檔，這期會變成逾期繳交。確定要換嗎？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" onClick={() => (pendingFileRef.current = null)} />}>
              取消
            </DialogClose>
            <Button type="button" onClick={onConfirmLateReplace}>
              確定要換
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Fix round 1（controller ruling 1）：這句警告在鎖定／編輯／檢視三個分支都要看得到，不是
// 只有原本的檢視分支。抽成共用元件，三個分支各自渲染一次，不用擔心之後改文字漏改到某一支。
function ReplaceWarning() {
  return <p className="text-sm text-[color:var(--warn,#8A5300)]">⚠️ 替換檔案後，繳交時間以新檔案為準。</p>;
}

function ReadonlyFields({ did, blocked, nextSteps }: { did: string; blocked: string; nextSteps: string }) {
  return (
    <dl className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <dt className="font-medium text-foreground">這兩週做了什麼</dt>
        <dd className="whitespace-pre-wrap text-muted-foreground">{did}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="font-medium text-foreground">卡在哪裡</dt>
        <dd className="whitespace-pre-wrap text-muted-foreground">{blocked}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="font-medium text-foreground">接下來要做什麼</dt>
        <dd className="whitespace-pre-wrap text-muted-foreground">{nextSteps}</dd>
      </div>
    </dl>
  );
}
