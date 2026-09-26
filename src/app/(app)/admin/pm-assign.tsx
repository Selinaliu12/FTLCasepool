"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setPmGroups } from "@/server/actions/admin";

export type PmMember = { id: string; name: string };
export type SimpleGroup = { id: string; name: string };

export function PmAssign({
  pms,
  groups,
  initialAssignments,
}: {
  pms: PmMember[];
  groups: SimpleGroup[];
  initialAssignments: Record<string, string[]>;
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState(initialAssignments);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(pmId: string, groupId: string, checked: boolean) {
    const before = assignments[pmId] ?? [];
    const after = checked ? [...before, groupId] : before.filter((g) => g !== groupId);
    setAssignments((a) => ({ ...a, [pmId]: after }));
    setPendingKey(`${pmId}:${groupId}`);
    setError(null);
    try {
      await setPmGroups(pmId, after);
      router.refresh();
    } catch (err) {
      // 失敗就退回原本的勾選狀態，避免畫面跟資料庫不一致。
      setAssignments((a) => ({ ...a, [pmId]: before }));
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setPendingKey(null);
    }
  }

  if (pms.length === 0) {
    return <p className="text-sm text-muted-foreground">還沒有專案幹部，匯入名單後才會出現在這裡。</p>;
  }
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">還沒有任何組別，匯入名單後才會出現在這裡。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>專案幹部</TableHead>
            {groups.map((g) => (
              <TableHead key={g.id}>{g.name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pms.map((pm) => (
            <TableRow key={pm.id}>
              <TableCell>{pm.name}</TableCell>
              {groups.map((g) => {
                const key = `${pm.id}:${g.id}`;
                const checked = (assignments[pm.id] ?? []).includes(g.id);
                return (
                  <TableCell key={g.id}>
                    <Checkbox
                      aria-label={`${pm.name} 負責 ${g.name}`}
                      checked={checked}
                      disabled={pendingKey === key}
                      onCheckedChange={(v) => toggle(pm.id, g.id, v === true)}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
