"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { importRoster } from "@/server/actions/admin";

export function RosterImport({ semesterId, alreadyImported }: { semesterId: string; alreadyImported: boolean }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function submit(text: string) {
    setPending(true);
    setErrors([]);
    setImportedCount(null);
    try {
      const result = await importRoster(semesterId, text);
      if (result.ok) {
        setImportedCount(result.imported);
        router.refresh();
      } else {
        setErrors(result.errors);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "匯入失敗"]);
    } finally {
      setPending(false);
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    await submit(text);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit(csv);
  }

  return (
    <div className="flex flex-col gap-3">
      {alreadyImported && (
        <p className="text-sm text-muted-foreground">本學期已匯入名單；學期中的異動請用下面的「換組」。</p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="名單匯入">
        <Textarea
          aria-label="貼上名單 CSV"
          placeholder={"email,姓名,角色,學號,系級,組別,專案名稱\na@g.nccu.edu.tw,王小明,專案生,110701001,資科三,第1組,智慧記帳"}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || !csv.trim()}>
            {pending ? "匯入中…" : "匯入名單"}
          </Button>
          <span className="text-sm text-muted-foreground">或</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="上傳 CSV 檔案"
            onChange={onFileChange}
            disabled={pending}
            className="text-sm"
          />
        </div>
      </form>

      {importedCount !== null && (
        <p role="status" className="text-sm text-[color:var(--ok)]">
          已匯入 {importedCount} 人
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-sm text-destructive">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
