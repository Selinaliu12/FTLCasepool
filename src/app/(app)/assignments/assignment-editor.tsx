"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { createAssignment, updateAssignment, deleteAssignment, type AssignmentFormInput, type AuthorResult } from "@/server/actions/assignments";

// 出題者的新增／修改／刪除（規格 §17-1～3、7、8）。取消派給已交的組、刪除已有人交的作業時，
// 伺服器回 needsConfirm（N 組已交），這裡打開打字確認視窗，打「刪除」才能按確定，再帶 N 送一次。
const CONFIRM_WORD = "刪除";
const DEFAULT_TIME = "23:59";

export type EditorGroup = { id: string; name: string };
export type EditorAssignment = { id: string; title: string; description: string; deadlineDate: string; deadlineTime: string; groupIds: string[] };

function ConfirmDialog({
  message,
  pending,
  onCancel,
  onConfirm,
}: {
  message: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && !pending && (setTyped(""), onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>確定要刪除已有人交的作業嗎？</DialogTitle>
          <DialogDescription className="text-[var(--danger)]">{message}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-assignment-delete">輸入「{CONFIRM_WORD}」確認</Label>
          <Input id="confirm-assignment-delete" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>取消</DialogClose>
          <Button type="button" variant="destructive" disabled={pending || typed.trim() !== CONFIRM_WORD} onClick={onConfirm}>
            {pending ? "刪除中…" : "確定刪除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignmentEditor({ groups, assignment }: { groups: EditorGroup[]; assignment?: EditorAssignment }) {
  const router = useRouter();
  const editing = assignment !== undefined;
  const empty: AssignmentFormInput = { title: "", description: "", deadlineDate: "", deadlineTime: DEFAULT_TIME, groupIds: [] };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AssignmentFormInput>(assignment ?? empty);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; count: number } | null>(null);

  function openDialog() {
    setForm(assignment ?? empty);
    setError(null);
    setOpen(true);
  }

  function toggle(id: string, checked: boolean) {
    setForm((f) => ({ ...f, groupIds: checked ? [...f.groupIds, id] : f.groupIds.filter((g) => g !== id) }));
  }

  async function save(confirmCount = 0) {
    setPending(true);
    setError(null);
    let r: AuthorResult;
    try {
      r = editing ? await updateAssignment(assignment.id, form, confirmCount) : await createAssignment(form);
    } catch {
      r = { ok: false, error: "儲存失敗，請再試一次" };
    }
    setPending(false);
    if (r.ok) {
      setConfirm(null);
      setOpen(false);
      router.refresh();
      return;
    }
    if (r.needsConfirm !== undefined) {
      setConfirm({ message: r.error, count: r.needsConfirm });
      return;
    }
    setConfirm(null);
    setError(r.error);
  }

  const allSelected = groups.length > 0 && form.groupIds.length === groups.length;

  return (
    <>
      <Button type="button" variant={editing ? "outline" : "default"} size={editing ? "sm" : "default"} onClick={openDialog}>
        {editing ? "修改" : "出新作業"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "修改作業" : "出新作業"}</DialogTitle>
            <DialogDescription>規則同雙週進度：每組交 1 份 PDF，2 小時內可改，逾期會亮燈。</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assignment-title">標題</Label>
              <Input id="assignment-title" value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assignment-description">說明（選填）</Label>
              <Textarea
                id="assignment-description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assignment-date">截止日期</Label>
                <Input id="assignment-date" type="date" value={form.deadlineDate} onChange={(e) => setForm({ ...form, deadlineDate: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assignment-time">時間</Label>
                <Input id="assignment-time" type="time" value={form.deadlineTime} onChange={(e) => setForm({ ...form, deadlineTime: e.target.value })} />
              </div>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-foreground">派給哪些組</legend>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label="全部組別"
                  checked={allSelected}
                  onCheckedChange={(v) => setForm({ ...form, groupIds: v === true ? groups.map((g) => g.id) : [] })}
                />
                全部
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <Checkbox aria-label={g.name} checked={form.groupIds.includes(g.id)} onCheckedChange={(v) => toggle(g.id, v === true)} />
                    {g.name}
                  </label>
                ))}
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>取消</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "儲存中…" : editing ? "儲存" : "出作業"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        key={confirm ? `${confirm.count}` : "closed"}
        message={confirm?.message ?? null}
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void save(confirm?.count ?? 0)}
      />
    </>
  );
}

export function DeleteAssignmentButton({ assignmentId, title }: { assignmentId: string; title: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [askSimple, setAskSimple] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(confirmCount = 0) {
    setPending(true);
    setError(null);
    let r: AuthorResult;
    try {
      r = await deleteAssignment(assignmentId, confirmCount);
    } catch {
      r = { ok: false, error: "刪除失敗，請再試一次" };
    }
    setPending(false);
    setAskSimple(false);
    if (r.ok) {
      setConfirm(null);
      router.refresh();
      return;
    }
    if (r.needsConfirm !== undefined) setConfirm({ message: r.error, count: r.needsConfirm });
    else {
      setConfirm(null);
      setError(r.error);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setAskSimple(true)} aria-label={`刪除作業「${title}」`}>
        刪除
      </Button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      <Dialog open={askSimple} onOpenChange={(o) => !pending && setAskSimple(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>刪除作業「{title}」？</DialogTitle>
            <DialogDescription>刪除後各組不用再交，燈號與準時率會重算。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>取消</DialogClose>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => void run()}>
              {pending ? "刪除中…" : "刪除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        key={confirm ? `${confirm.count}` : "closed"}
        message={confirm?.message ?? null}
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run(confirm?.count ?? 0)}
      />
    </>
  );
}
