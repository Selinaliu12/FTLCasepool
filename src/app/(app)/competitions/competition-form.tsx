"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  createCompetition,
  updateCompetition,
  publishCompetition,
  unpublishCompetition,
  type CompetitionFormInput,
} from "@/server/actions/competitions";
import { COMPETITION_TAGS, LONG_TEXT_FIELD_LABELS } from "@/domain/competition";
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
  summary: "summary",
  tags: "tags",
  maxPrize: "maxPrize",
  perks: "perks",
  infoSessionDate: "infoSessionAt",
  infoSessionTime: "infoSessionAt",
  signupNote: "signupNote",
  submissionNote: "submissionNote",
  finalNote: "finalNote",
  finalFormat: "finalFormat",
  fee: "fee",
  documents: "documents",
  skills: "skills",
  recommended: undefined,
  staffNote: "staffNote",
};

export function CompetitionForm({
  competitionId,
  initial,
  status,
  initialError,
}: {
  competitionId?: string;
  initial: CompetitionFormValues;
  status?: "draft" | "published";
  initialError?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<CompetitionFormValues>(initial);
  const [errors, setErrors] = useState<CompetitionFieldErrors>({});
  const [pending, setPending] = useState<"draft" | "publish" | "unpublish" | null>(null);
  const [formError, setFormError] = useState<string | null>(initialError ?? null);

  function set<K extends keyof CompetitionFormValues>(key: K, v: CompetitionFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
    const errorKey = ERROR_KEY[key];
    if (errorKey) setErrors((prev) => ({ ...prev, [errorKey]: undefined }));
  }

  function toggleTag(tag: string) {
    setValues((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag],
    }));
    setErrors((prev) => ({ ...prev, tags: undefined }));
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
      try {
        await publishCompetition(result.id);
        router.push("/competitions");
      } catch (err) {
        const message = err instanceof Error ? err.message : "發布失敗";
        // Minor 2（fix round 1）：如果剛剛是從 /new 存成草稿（competitionId 原本是 undefined），
        // 存草稿那一步已經成功、只是接下來的發布失敗——不能留在 /new，不然使用者以為整個
        // 都沒存到，再按一次「發布」會用同一份表單內容再建一筆重複的草稿。改成導去這筆
        // 剛剛建出來的草稿的編輯頁，錯誤訊息用查詢字串一起帶過去，讓編輯頁顯示出來。
        if (!competitionId) {
          router.push(`/competitions/${result.id}/edit?publishError=${encodeURIComponent(message)}`);
          return;
        }
        setFormError(message);
      }
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
      const result = await unpublishCompetition(competitionId);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "取消發布失敗");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-8" aria-label="競賽表單">
      {/* 基本資料 */}
      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-lg font-semibold text-foreground">基本資料</h2>

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
          <Label htmlFor="comp-summary">一句話介紹（選填）</Label>
          <Input id="comp-summary" value={values.summary} disabled={busy} onChange={(e) => set("summary", e.target.value)} />
          {errors.summary && (
            <p role="alert" className="text-sm text-destructive">
              {errors.summary}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-theme">主題（選填）</Label>
          <Textarea id="comp-theme" value={values.theme} disabled={busy} onChange={(e) => set("theme", e.target.value)} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-foreground">比賽類型標籤（選填，可多選）</legend>
          <div className="flex flex-wrap gap-4">
            {COMPETITION_TAGS.map((tag) => (
              <label key={tag} className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={values.tags.includes(tag)} disabled={busy} onCheckedChange={() => toggleTag(tag)} />
                {tag}
              </label>
            ))}
          </div>
          {errors.tags && (
            <p role="alert" className="text-sm text-destructive">
              {errors.tags}
            </p>
          )}
        </fieldset>
      </section>

      {/* 參賽資格 */}
      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-lg font-semibold text-foreground">參賽資格</h2>

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
      </section>

      {/* 賽程與繳交 */}
      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-lg font-semibold text-foreground">賽程與繳交</h2>

        <div className="flex flex-col gap-1">
          <Label>說明會（選填）</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              aria-label="說明會日期"
              value={values.infoSessionDate}
              disabled={busy}
              onChange={(e) => set("infoSessionDate", e.target.value)}
            />
            <Input
              type="time"
              aria-label="說明會時間"
              value={values.infoSessionTime}
              disabled={busy}
              onChange={(e) => set("infoSessionTime", e.target.value)}
            />
          </div>
          {errors.infoSessionAt && (
            <p role="alert" className="text-sm text-destructive">
              {errors.infoSessionAt}
            </p>
          )}
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
          <Label htmlFor="comp-signup-note">{LONG_TEXT_FIELD_LABELS.signupNote}（選填）</Label>
          <Textarea
            id="comp-signup-note"
            value={values.signupNote}
            disabled={busy}
            onChange={(e) => set("signupNote", e.target.value)}
          />
          {errors.signupNote && (
            <p role="alert" className="text-sm text-destructive">
              {errors.signupNote}
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
          <Label htmlFor="comp-submission-note">{LONG_TEXT_FIELD_LABELS.submissionNote}（選填）</Label>
          <Textarea
            id="comp-submission-note"
            value={values.submissionNote}
            disabled={busy}
            onChange={(e) => set("submissionNote", e.target.value)}
          />
          {errors.submissionNote && (
            <p role="alert" className="text-sm text-destructive">
              {errors.submissionNote}
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

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-final-note">{LONG_TEXT_FIELD_LABELS.finalNote}（選填）</Label>
          <Textarea
            id="comp-final-note"
            value={values.finalNote}
            disabled={busy}
            onChange={(e) => set("finalNote", e.target.value)}
          />
          {errors.finalNote && (
            <p role="alert" className="text-sm text-destructive">
              {errors.finalNote}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-final-format">{LONG_TEXT_FIELD_LABELS.finalFormat}（選填）</Label>
          <Textarea
            id="comp-final-format"
            value={values.finalFormat}
            disabled={busy}
            onChange={(e) => set("finalFormat", e.target.value)}
          />
          {errors.finalFormat && (
            <p role="alert" className="text-sm text-destructive">
              {errors.finalFormat}
            </p>
          )}
        </div>
      </section>

      {/* 獎勵與機會 */}
      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-lg font-semibold text-foreground">獎勵與機會</h2>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-prize">獎項（選填）</Label>
          <Textarea id="comp-prize" value={values.prize} disabled={busy} onChange={(e) => set("prize", e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-max-prize">最高獎金（選填，新台幣整數）</Label>
          <Input
            id="comp-max-prize"
            inputMode="numeric"
            value={values.maxPrize}
            disabled={busy}
            onChange={(e) => set("maxPrize", e.target.value)}
          />
          {errors.maxPrize && (
            <p role="alert" className="text-sm text-destructive">
              {errors.maxPrize}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-perks">{LONG_TEXT_FIELD_LABELS.perks}（選填）</Label>
          <Textarea id="comp-perks" value={values.perks} disabled={busy} onChange={(e) => set("perks", e.target.value)} />
          {errors.perks && (
            <p role="alert" className="text-sm text-destructive">
              {errors.perks}
            </p>
          )}
        </div>
      </section>

      {/* 報名方式與幹部備註 */}
      <section className="flex flex-col gap-5">
        <h2 className="font-heading text-lg font-semibold text-foreground">報名方式與幹部備註</h2>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-fee">{LONG_TEXT_FIELD_LABELS.fee}（選填）</Label>
          <Input id="comp-fee" value={values.fee} disabled={busy} onChange={(e) => set("fee", e.target.value)} />
          {errors.fee && (
            <p role="alert" className="text-sm text-destructive">
              {errors.fee}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-documents">{LONG_TEXT_FIELD_LABELS.documents}（選填）</Label>
          <Textarea
            id="comp-documents"
            value={values.documents}
            disabled={busy}
            onChange={(e) => set("documents", e.target.value)}
          />
          {errors.documents && (
            <p role="alert" className="text-sm text-destructive">
              {errors.documents}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-skills">{LONG_TEXT_FIELD_LABELS.skills}（選填）</Label>
          <Textarea id="comp-skills" value={values.skills} disabled={busy} onChange={(e) => set("skills", e.target.value)} />
          {errors.skills && (
            <p role="alert" className="text-sm text-destructive">
              {errors.skills}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="comp-recommended"
            checked={values.recommended}
            disabled={busy}
            onCheckedChange={(checked) => set("recommended", checked === true)}
            aria-label="幹部推薦"
          />
          <Label htmlFor="comp-recommended">幹部推薦</Label>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="comp-staff-note">{LONG_TEXT_FIELD_LABELS.staffNote}（選填）</Label>
          <Textarea
            id="comp-staff-note"
            value={values.staffNote}
            disabled={busy}
            onChange={(e) => set("staffNote", e.target.value)}
          />
          {errors.staffNote && (
            <p role="alert" className="text-sm text-destructive">
              {errors.staffNote}
            </p>
          )}
        </div>
      </section>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <div className="flex gap-2">
        {/* Minor 3（fix round 1）：已發布的卡片按這顆按鈕只是存欄位變更，不會把狀態改回草稿——
            按鈕文字改成「儲存」，避免看起來像「存草稿」但其實沒有取消發布。要取消發布，
            另外按旁邊明確的「取消發布」（呼叫 unpublishCompetition）。 */}
        <Button type="button" variant="outline" disabled={busy} onClick={onSaveDraft}>
          {pending === "draft" ? "儲存中…" : status === "published" ? "儲存" : "存草稿"}
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
