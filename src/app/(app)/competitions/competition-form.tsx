"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  createCompetition,
  updateCompetition,
  publishCompetition,
  unpublishCompetition,
  type CompetitionFormInput,
} from "@/server/actions/competitions";
import type { CompetitionFieldErrors } from "@/domain/competition";

import type { CompetitionFormValues } from "./competition-form-defaults";
export type { CompetitionFormValues };

// 表單欄位對應到 validateCompetition／server action 回傳的錯誤 key：日期＋時間兩個輸入框
// 共用同一個錯誤（例如 signupDate／signupTime 都對應 signupDeadline）。
const ERROR_KEY: Record<keyof CompetitionFormValues, keyof CompetitionFieldErrors | undefined> = {
  name: "name",
  organizer: undefined,
  theme: undefined,
  eligibility: undefined,
  teamSize: undefined,
  prize: undefined,
  url: "url",
  signupDate: "signupDeadline",
  signupTime: "signupDeadline",
  submissionDate: "submissionDeadline",
  submissionTime: "submissionDeadline",
  finalDate: "finalDate",
  finalTime: "finalDate",
};

export function CompetitionForm({
  competitionId,
  initial,
  status,
}: {
  competitionId?: string;
  initial: CompetitionFormValues;
  status?: "draft" | "published";
}) {
  const router = useRouter();
  const [values, setValues] = useState<CompetitionFormValues>(initial);
  const [errors, setErrors] = useState<CompetitionFieldErrors>({});
  const [pending, setPending] = useState<"draft" | "publish" | "unpublish" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function set<K extends keyof CompetitionFormValues>(key: K, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    const errorKey = ERROR_KEY[key];
    if (errorKey) setErrors((prev) => ({ ...prev, [errorKey]: undefined }));
  }

  function toInput(): CompetitionFormInput {
    return { ...values };
  }

  async function saveOrCreate(): Promise<{ ok: true; id: string } | { ok: false }> {
    if (competitionId) {
      const result = await updateCompetition(competitionId, toInput());
      if (!result.ok) {
        setErrors(result.errors);
        return { ok: false };
      }
      return { ok: true, id: competitionId };
    }
    const created = await createCompetition(toInput());
    if (!created.ok) {
      setErrors(created.errors);
      return { ok: false };
    }
    return { ok: true, id: created.id };
  }

  async function onSaveDraft() {
    if (pending) return;
    setPending("draft");
    setFormError(null);
    setErrors({});
    try {
      const result = await saveOrCreate();
      if (!result.ok) return;
      router.push(`/competitions/${result.id}/edit`);
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setPending(null);
    }
  }

  async function onPublish() {
    if (pending) return;
    setPending("publish");
    setFormError(null);
    setErrors({});
    try {
      const result = await saveOrCreate();
      if (!result.ok) return;
      await publishCompetition(result.id);
      router.push("/competitions");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "發布失敗");
    } finally {
      setPending(null);
    }
  }

  async function onUnpublish() {
    if (pending || !competitionId) return;
    setPending("unpublish");
    setFormError(null);
    try {
      await unpublishCompetition(competitionId);
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "取消發布失敗");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-5" aria-label="競賽表單">
      <div className="flex flex-col gap-1">
        <Label htmlFor="comp-name">比賽名稱</Label>
        <Input id="comp-name" value={values.name} disabled={busy} onChange={(e) => set("name", e.target.value)} />
        {errors.name && (
          <p role="alert" className="text-sm text-destructive">
            {errors.name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comp-url">官方連結</Label>
        <Input
          id="comp-url"
          type="url"
          placeholder="https://"
          value={values.url}
          disabled={busy}
          onChange={(e) => set("url", e.target.value)}
        />
        {errors.url && (
          <p role="alert" className="text-sm text-destructive">
            {errors.url}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comp-organizer">主辦單位（選填）</Label>
        <Input id="comp-organizer" value={values.organizer} disabled={busy} onChange={(e) => set("organizer", e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comp-theme">主題（選填）</Label>
        <Textarea id="comp-theme" value={values.theme} disabled={busy} onChange={(e) => set("theme", e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comp-eligibility">參賽資格（選填）</Label>
        <Textarea
          id="comp-eligibility"
          value={values.eligibility}
          disabled={busy}
          onChange={(e) => set("eligibility", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comp-team-size">隊伍人數（選填）</Label>
        <Input id="comp-team-size" value={values.teamSize} disabled={busy} onChange={(e) => set("teamSize", e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comp-prize">獎項（選填）</Label>
        <Textarea id="comp-prize" value={values.prize} disabled={busy} onChange={(e) => set("prize", e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <Label>報名截止日</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            aria-label="報名截止日期"
            value={values.signupDate}
            disabled={busy}
            onChange={(e) => set("signupDate", e.target.value)}
          />
          <Input
            type="time"
            aria-label="報名截止時間"
            value={values.signupTime}
            disabled={busy}
            onChange={(e) => set("signupTime", e.target.value)}
          />
        </div>
        {errors.signupDeadline && (
          <p role="alert" className="text-sm text-destructive">
            {errors.signupDeadline}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label>繳件截止日（選填）</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            aria-label="繳件截止日期"
            value={values.submissionDate}
            disabled={busy}
            onChange={(e) => set("submissionDate", e.target.value)}
          />
          <Input
            type="time"
            aria-label="繳件截止時間"
            value={values.submissionTime}
            disabled={busy}
            onChange={(e) => set("submissionTime", e.target.value)}
          />
        </div>
        {errors.submissionDeadline && (
          <p role="alert" className="text-sm text-destructive">
            {errors.submissionDeadline}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label>決賽日期（選填）</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            aria-label="決賽日期"
            value={values.finalDate}
            disabled={busy}
            onChange={(e) => set("finalDate", e.target.value)}
          />
          <Input
            type="time"
            aria-label="決賽時間"
            value={values.finalTime}
            disabled={busy}
            onChange={(e) => set("finalTime", e.target.value)}
          />
        </div>
        {errors.finalDate && (
          <p role="alert" className="text-sm text-destructive">
            {errors.finalDate}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onSaveDraft}>
          {pending === "draft" ? "儲存中…" : "存草稿"}
        </Button>
        {status === "published" ? (
          <Button type="button" variant="outline" disabled={busy} onClick={onUnpublish}>
            {pending === "unpublish" ? "處理中…" : "取消發布"}
          </Button>
        ) : (
          <Button type="button" disabled={busy} onClick={onPublish}>
            {pending === "publish" ? "發布中…" : "發布"}
          </Button>
        )}
      </div>
    </form>
  );
}
