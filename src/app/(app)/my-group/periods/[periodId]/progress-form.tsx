"use client";

import { useState, useRef } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { validateProgress, type ProgressInput } from "@/domain/progress";
import { validatePdfMeta } from "@/domain/pdf";
import type { Light } from "@/domain/lights";
import { LIGHT_OPTIONS, putWithProgress } from "./report-shared";
import { requestPdfUpload } from "@/server/actions/upload";
import { submitProgress } from "@/server/actions/progress";
import { markSubmittedToast } from "../../submitted-toast";

type FieldErrors = Partial<Record<keyof ProgressInput, string>>;

export function ProgressForm({ periodId }: { periodId: string }) {
  const fileInputId = "progress-pdf";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [light, setLight] = useState<Light | null>(null);
  const [did, setDid] = useState("");
  const [blocked, setBlocked] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(null);
    setFileError(null);
    setErrors((prev) => ({ ...prev, hasPdf: undefined }));
    if (!f) return;
    const meta = validatePdfMeta({ name: f.name, type: f.type, size: f.size });
    if (!meta.ok) {
      setFileError(meta.error);
      return;
    }
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (uploading) return;

    const validation = validateProgress({ light, did, blocked, nextSteps, hasPdf: !!file });
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setUploading(true);
    setUploadProgress(0);

    try {
      const upload = await requestPdfUpload({ name: file!.name, type: file!.type, size: file!.size });
      if (!upload.ok) {
        setSubmitError(upload.error);
        setUploading(false);
        return;
      }

      await putWithProgress(upload.url, file!, setUploadProgress);

      const result = await submitProgress(periodId, {
        light: light!,
        did,
        blocked,
        nextSteps,
        pdfKey: upload.key,
      });
      if (!result.ok) {
        setSubmitError(result.error);
        setUploading(false);
        return;
      }

      // Fix round 1：一次送出只做一次導頁（見 submitted-toast.tsx 開頭的註解）——不再靠
      // ?submitted=1 這個 query string 帶著「要跳提示」這件事跑一趟，改用 sessionStorage
      // 存旗標，直接導到乾淨的網址。
      //
      // 最終修正：改成整頁載入（location.assign），不用 router.push。實測送出後 client router
      // 會對 /my-group 發兩次 RSC 請求（push 一次、接著 layout-router 帶 "refetch" 標記再抓一次），
      // 第二次會中斷第一次；如果第一次的 RSC 串流已經收到一半，`next dev` 的 React 開發版會在
      // 處理「被中斷」時踩到自己的 bug（frame.join is not a function）整個畫面崩潰。改成整頁載入
      // 就沒有 client 端 RSC 串流可以被中斷；送出本來就是一次性的動作，多一次整頁載入的成本可以接受，
      // 也保證回到組頁看到的是伺服器最新的資料。
      markSubmittedToast();
      window.location.assign("/my-group");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "上傳失敗，請重試");
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" aria-label="交這期進度">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">燈號</legend>
        <div className="grid grid-cols-3 gap-2">
          {LIGHT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-label={opt.label}
              aria-pressed={light === opt.value}
              disabled={uploading}
              onClick={() => {
                setLight(opt.value);
                setErrors((prev) => ({ ...prev, light: undefined }));
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded-[var(--r-sm,12px)] border p-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                light === opt.value ? "border-primary bg-primary/10" : "border-[var(--line,#DEE9F8)]"
              )}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.hint}</span>
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
        <label htmlFor="progress-did" className="text-sm font-medium">
          這兩週做了什麼
        </label>
        <Textarea
          id="progress-did"
          value={did}
          disabled={uploading}
          onChange={(e) => {
            setDid(e.target.value);
            setErrors((prev) => ({ ...prev, did: undefined }));
          }}
        />
        {errors.did && (
          <p role="alert" className="text-sm text-destructive">
            {errors.did}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="progress-blocked" className="text-sm font-medium">
          卡在哪裡
        </label>
        <Textarea
          id="progress-blocked"
          value={blocked}
          disabled={uploading}
          onChange={(e) => {
            setBlocked(e.target.value);
            setErrors((prev) => ({ ...prev, blocked: undefined }));
          }}
        />
        {errors.blocked && (
          <p role="alert" className="text-sm text-destructive">
            {errors.blocked}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="progress-next-steps" className="text-sm font-medium">
          接下來要做什麼
        </label>
        <Textarea
          id="progress-next-steps"
          value={nextSteps}
          disabled={uploading}
          onChange={(e) => {
            setNextSteps(e.target.value);
            setErrors((prev) => ({ ...prev, nextSteps: undefined }));
          }}
        />
        {errors.nextSteps && (
          <p role="alert" className="text-sm text-destructive">
            {errors.nextSteps}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={fileInputId} className="text-sm font-medium">
          PDF（建議內容：本期成果截圖、會議紀錄、下期分工）
        </label>
        <input
          id={fileInputId}
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={onFileChange}
        />
        {file && <p className="text-sm text-muted-foreground">已選擇：{file.name}</p>}
        {fileError && (
          <p role="alert" className="text-sm text-destructive">
            {fileError}
          </p>
        )}
        {errors.hasPdf && !fileError && (
          <p role="alert" className="text-sm text-destructive">
            {errors.hasPdf}
          </p>
        )}
        {uploading && (
          <p className="text-sm text-muted-foreground">上傳中… {uploadProgress}%</p>
        )}
      </div>

      <p className="text-sm text-[color:var(--warn,#8A5300)]">⚠️ 替換檔案後，繳交時間以新檔案為準。</p>

      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      <Button type="submit" disabled={uploading}>
        {uploading ? "上傳中…" : "送出"}
      </Button>
    </form>
  );
}
