"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSemester } from "@/server/actions/admin";

export function CreateSemesterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createSemester(name.trim());
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-label="建立學期">
      <Input
        aria-label="學期名稱"
        placeholder="例如 115-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || !name.trim()}>
        {pending ? "建立中…" : "建立學期"}
      </Button>
    </form>
  );
}
