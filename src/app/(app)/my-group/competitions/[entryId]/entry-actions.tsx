"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmEntry, withdrawEntry, setEntryMembers } from "@/server/actions/entries";
import type { EntryDetail } from "@/server/queries/entries";

// 已經確認過的參賽成員清單：換組的人不會消失，標成「（已換組）」（controller ruling，
// fix round 1）——不然看起來像這個人從沒參加過這場比賽。fix round 2（cosmetic）：如果
// entry_members 指到的那筆 member 整列都不在了（不是換組，是真的查不到名字），movedOut 還是
// true 但 name 會是空字串——這時候顯示「（已不在名單）」，不要顯示空白名字＋「（已換組）」。
function memberLabel(m: { name: string; movedOut: boolean }): string {
  if (!m.movedOut) return m.name;
  return m.name ? `${m.name}（已換組）` : "（已不在名單）";
}

// fix round 2：候選名單（可以勾選的人）只有「現在還在這組的專案生」。已換組的成員即使原本
// 在 entry.selectedMemberIds 裡，也不該留在 selected 狀態裡——不然那個 id 永遠不會出現在
// checkbox 列表，使用者永遠沒辦法把它勾掉，每次儲存都會被 update_entry_members() 擋下來
// （只能勾選自己組的專案生）。進入編輯模式、以及「取消」還原時都要套用這個過濾。
function currentGroupSelection(entry: EntryDetail): string[] {
  const groupStudentIds = new Set(entry.groupStudents.map((s) => s.id));
  return entry.selectedMemberIds.filter((id) => groupStudentIds.has(id));
}

// 勾選參賽成員的表單（確認報名前、以及確認之後的「編輯參賽成員」共用）。只能勾自己組現在的
// 專案生（換組的人不會出現在這個候選名單裡；儲存時會用新的整份名單覆蓋掉舊的）。
function MemberCheckboxes({
  groupStudents,
  selected,
  onToggle,
}: {
  groupStudents: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">參賽成員</p>
      {groupStudents.map((s) => (
        <label key={s.id} className="flex items-center gap-2 text-sm">
          <Checkbox checked={selected.includes(s.id)} onCheckedChange={(v) => onToggle(s.id, v === true)} />
          {s.name}
        </label>
      ))}
    </div>
  );
}

// 報名頁的主要互動：還沒確認時勾參賽成員＋「確認報名」（確認對話框）；確認過（且沒退出）時
// 顯示已選成員（換組的人標「已換組」）＋「編輯參賽成員」（確認後參賽成員本身還是可以改，
// 規格：「確認後不能再改參賽成員以外的設定」）＋「取消報名」（確認對話框，說明檔案與審核
// 紀錄會保留）。
export function EntryActions({ entry, myMemberId }: { entry: EntryDetail; myMemberId: string | null }) {
  const router = useRouter();
  // fix round 2：初始值也要先過濾掉已經換組的成員（currentGroupSelection），不能直接拿
  // entry.selectedMemberIds——換組的人不會出現在候選 checkbox 列表裡，selected 裡如果留著
  // 那個 id，使用者永遠沒辦法把它勾掉。
  const [selected, setSelected] = useState<string[]>(() => {
    const filtered = currentGroupSelection(entry);
    return filtered.length > 0 ? filtered : myMemberId ? [myMemberId] : [];
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((m) => m !== id)));
    setError(null);
  }

  async function onConfirm() {
    setPending(true);
    try {
      const result = await confirmEntry(entry.entryId, selected);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      toast.success("已確認報名");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function onSaveMembers() {
    setPending(true);
    try {
      const result = await setEntryMembers(entry.entryId, selected);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setEditing(false);
      toast.success("已更新參賽成員");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function onWithdraw() {
    setPending(true);
    try {
      const result = await withdrawEntry(entry.entryId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setWithdrawOpen(false);
      toast.success("已取消報名");
      router.push("/my-group");
    } finally {
      setPending(false);
    }
  }

  if (entry.status === "in_progress" || entry.status === "withdrawn") {
    // fix round 2：已換組的成員（movedOut）不在候選名單裡，儲存時會被整份新名單覆蓋掉、
    // 自然被移除——進編輯模式前先提醒使用者。空字串名字（member 那筆資料整列都不見了）也算，
    // 一律用「（已不在名單）」代替空白。
    const movedOutNames = entry.selectedMembers.filter((m) => m.movedOut).map((m) => m.name || "（已不在名單）");

    if (editing) {
      return (
        <div className="flex flex-col gap-3">
          <MemberCheckboxes groupStudents={entry.groupStudents} selected={selected} onToggle={toggle} />
          {movedOutNames.length > 0 && (
            <p className="text-sm text-muted-foreground">
              已換組的同學（{movedOutNames.join("、")}）儲存後會從參賽名單移除
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" onClick={onSaveMembers} disabled={pending}>
              {pending ? "儲存中…" : "儲存"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setSelected(currentGroupSelection(entry));
                setError(null);
              }}
            >
              取消
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm text-muted-foreground">參賽成員</p>
          <p className="text-foreground">{entry.selectedMembers.map(memberLabel).join("、") || "—"}</p>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {entry.status === "in_progress" && (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => {
                  setSelected(currentGroupSelection(entry));
                  setEditing(true);
                }}
              >
                編輯參賽成員
              </Button>
              <Button type="button" variant="outline" className="self-start" onClick={() => setWithdrawOpen(true)}>
                取消報名
              </Button>
            </div>
            <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>確定要取消報名嗎？</DialogTitle>
                  <DialogDescription>
                    取消後這場比賽會標成已退出，之前上傳的檔案與審核紀錄都會保留。取消後可以重新掛這場比賽。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
                    再想想
                  </DialogClose>
                  <Button type="button" variant="destructive" onClick={onWithdraw} disabled={pending}>
                    {pending ? "處理中…" : "確定取消報名"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <MemberCheckboxes groupStudents={entry.groupStudents} selected={selected} onToggle={toggle} />

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <Button type="button" className="self-start" onClick={() => setConfirmOpen(true)} disabled={pending}>
        確認報名
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確定要確認報名嗎？</DialogTitle>
            <DialogDescription>確認後不能再改參賽成員以外的設定；參賽成員之後還是可以編輯。</DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>再想想</DialogClose>
            <Button type="button" onClick={onConfirm} disabled={pending}>
              {pending ? "送出中…" : "確定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
