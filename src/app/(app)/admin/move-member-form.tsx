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
        {/* F1 修正：base SelectContent 預設 `w-(--anchor-width)`，寬度鎖死跟觸發按鈕一樣寬，
            「姓名（學號）· 第N組」這種比按鈕長的文字會被裁掉，多身份的選項因此看起來一樣。
            這裡改成內容多寬視窗就多寬（w-max），下限維持跟觸發按鈕一樣寬，上限不超過視窗
            寬度（扣掉一點邊界），避免在 375 窄螢幕把頁面撐出水平捲軸。 */}
        <SelectContent className="w-max min-w-(--anchor-width) max-w-[calc(100vw-2rem)]">
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
