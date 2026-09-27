"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { moveMember } from "@/server/actions/admin";

export type SimpleMember = { id: string; name: string; studentId: string | null; groupName: string | null };
export type SimpleGroup = { id: string; name: string };

export function MoveMemberForm({ students, groups }: { students: SimpleMember[]; groups: SimpleGroup[] }) {
  const router = useRouter();
  const [memberId, setMemberId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onConfirm() {
    if (!memberId || !groupId) return;
    setPending(true);
    setError(null);
    setDone(false);
    try {
      await moveMember(memberId, groupId);
      setDone(true);
      setMemberId(null);
      setGroupId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "換組失敗");
    } finally {
      setPending(false);
    }
  }

  if (students.length === 0) {
    return <p className="text-sm text-muted-foreground">還沒有任何專案生，匯入名單後才會出現在這裡。</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={memberId ?? undefined} onValueChange={(v) => setMemberId(v as string)}>
        <SelectTrigger aria-label="選擇成員">
          <SelectValue placeholder="選擇成員" />
        </SelectTrigger>
        <SelectContent>
          {students.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}（{s.studentId ?? "—"}）· {s.groupName ?? "未分組"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-sm text-muted-foreground">換到</span>

      <Select value={groupId ?? undefined} onValueChange={(v) => setGroupId(v as string)}>
        <SelectTrigger aria-label="選擇組別">
          <SelectValue placeholder="選擇組別" />
        </SelectTrigger>
        <SelectContent>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button type="button" disabled={pending || !memberId || !groupId} onClick={onConfirm}>
        {pending ? "換組中…" : "確認"}
      </Button>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm text-[color:var(--ok)]">已換組</p>}
    </div>
  );
}
