"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { validateProgress, type ProgressInput } from "@/domain/progress";
import { validatePdfMeta } from "@/domain/pdf";
import type { Light } from "@/domain/lights";
import { requestPdfUpload } from "@/server/actions/upload";
import { submitProgress } from "@/server/actions/progress";

const LIGHT_OPTIONS: { value: Light; label: string; hint: string }[] = [
  { value: "green", label: "綠燈", hint: "進度正常" },
  { value: "yellow", label: "黃燈", hint: "有點落後，還在掌控中" },
  { value: "red", label: "紅燈", hint: "卡關，需要幫忙" },
];

type FieldErrors = Partial<Record<keyof ProgressInput, string>>;

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress(Math.round((evt.loaded / evt.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("上傳失敗，請重試")));
    xhr.onerror = () => reject(new Error("上傳失敗，請重試"));
    xhr.send(file);
  });
}

export function ProgressForm({ periodId }: { periodId: string }) {
  const router = useRouter();
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

      router.push("/my-group?submitted=1");
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
