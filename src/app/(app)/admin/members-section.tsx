"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addMember, changeEmail, updatePerson } from "@/server/actions/admin";
import { filterPeople, groupPeople, type MemberListRow, type Person } from "@/domain/member-list";

export type MemberGroupOption = { id: string; name: string };

// 管理員頁「成員」區塊（規格 §16，Task 5）：每個人一列（依信箱合併多個身份），可用姓名或學號
// 搜尋；已離開的身份預設隱藏，勾「顯示已離開」才看得到（要重新加回就用「新增成員」新增同一個身份）。
export function MembersSection({ rows, groups }: { rows: MemberListRow[]; groups: MemberGroupOption[] }) {
  const [query, setQuery] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const people = useMemo(() => groupPeople(rows), [rows]);
  const shown = filterPeople(people, query, showLeft);
  const hasAnyone = filterPeople(people, "", showLeft).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="搜尋姓名或學號"
          placeholder="搜尋姓名或學號"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full sm:w-56"
        />
        <Label className="font-normal">
          <Checkbox checked={showLeft} onCheckedChange={(v) => setShowLeft(v === true)} />
          顯示已離開
        </Label>
        <div className="sm:ml-auto">
          <AddMemberDialog groups={groups} />
        </div>
      </div>

      {!hasAnyone ? (
        <p className="text-sm text-muted-foreground">名單上還沒有任何人。匯入名單或按「新增成員」加入。</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">找不到符合的成員</p>
      ) : (
        // 三欄都可以換行（信箱 break-all、身份徽章 flex-wrap）；手機寬把「學號／系級」收進第一欄
        // （合成一行），只剩兩欄，375 寬也不用橫向捲動就看得到身份。
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[55%] sm:w-[42%]">姓名／信箱</TableHead>
              <TableHead className="hidden w-[24%] sm:table-cell">學號／系級</TableHead>
              <TableHead>身份</TableHead>
              <TableHead className="w-[1%]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((p) => (
              <TableRow key={p.email} className="align-top">
                <TableCell className="whitespace-normal">
                  <div className="font-medium text-foreground">{p.name}</div>
                  <div className="text-xs break-all text-[var(--ink-2,#3E4F70)]">{p.email}</div>
                  <div className="text-xs break-words text-[var(--ink-2,#3E4F70)] sm:hidden">
                    <span className="font-mono">{p.studentId ?? "—"}</span> · {p.deptYear ?? "—"}
                  </div>
                </TableCell>
                <TableCell className="hidden whitespace-normal sm:table-cell">
                  <div className="font-mono text-xs break-all">{p.studentId ?? "—"}</div>
                  <div className="text-xs break-words text-[var(--ink-2,#3E4F70)]">{p.deptYear ?? "—"}</div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-1">
                    {p.identities.map((i) =>
                      i.left ? (
                        <Badge key={i.memberId} variant="outline" className="h-auto whitespace-normal text-muted-foreground">
                          {i.label}（已離開）
                        </Badge>
                      ) : (
                        <Badge key={i.memberId} variant="secondary" className="h-auto whitespace-normal">
                          {i.label}
                        </Badge>
                      )
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <EditPersonDialog person={p} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

const ROLE_OPTIONS = ["專案生", "專案幹部", "其他幹部"] as const;
const EMPTY = { email: "", name: "", studentId: "", deptYear: "" };

function AddMemberDialog({ groups }: { groups: MemberGroupOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(EMPTY);
  const [role, setRole] = useState<string>("專案生");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFields(EMPTY);
    setRole("專案生");
    setGroupId(null);
    setError(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await addMember({ ...fields, role, groupId: role === "專案生" ? groupId ?? "" : "" });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const name = fields.name.trim();
      toast.success(res.restored ? `已把${name}重新加回名單` : `已新增${name}`);
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("新增失敗，請重試");
    } finally {
      setPending(false);
    }
  }

  const field = (key: keyof typeof EMPTY, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`add-member-${key}`}>{label}</Label>
      <Input
        id={`add-member-${key}`}
        value={fields[key]}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
        disabled={pending}
        {...props}
      />
    </div>
  );

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        新增成員
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增成員</DialogTitle>
            <DialogDescription>
              新增一個人，或替已在名單上的人加一個身份；同一個信箱的姓名、學號、系級要一致。已離開的身份再新增一次就會重新加回。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
            {field("email", "學校信箱", { type: "email", placeholder: "例：110701001@g.nccu.edu.tw", autoComplete: "off" })}
            {field("name", "姓名", { autoComplete: "off" })}
            <div className="grid grid-cols-2 gap-3">
              {field("studentId", "學號", { autoComplete: "off", inputMode: "numeric" })}
              {field("deptYear", "系級", { autoComplete: "off", placeholder: "例：資科三" })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>角色</Label>
                <Select value={role} onValueChange={(v) => setRole(v as string)} disabled={pending}>
                  <SelectTrigger aria-label="角色" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {role === "專案生" && (
                <div className="flex flex-col gap-1.5">
                  <Label>組別</Label>
                  <Select
                    value={groupId}
                    onValueChange={(v) => setGroupId(v as string)}
                    items={groups.map((g) => ({ value: g.id, label: g.name }))}
                    disabled={pending}
                  >
                    <SelectTrigger aria-label="組別" className="w-full">
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
                </div>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>取消</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "新增中…" : "新增"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const EMPTY_EDIT = { name: "", studentId: "", deptYear: "", email: "" };

function EditPersonDialog({ person }: { person: Person }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(EMPTY_EDIT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setFields({ name: person.name, studentId: person.studentId ?? "", deptYear: person.deptYear ?? "", email: person.email });
      setError(null);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const newEmail = fields.email.trim().toLowerCase();
      let currentEmail = person.email;
      if (newEmail !== person.email) {
        const emailRes = await changeEmail(person.email, newEmail);
        if (!emailRes.ok) {
          setError(emailRes.error);
          return;
        }
        currentEmail = newEmail;
      }

      const personRes = await updatePerson(currentEmail, {
        name: fields.name,
        studentId: fields.studentId,
        deptYear: fields.deptYear,
      });
      if (!personRes.ok) {
        setError(currentEmail !== person.email ? `信箱已改成功，但姓名等資料儲存失敗：${personRes.error}` : personRes.error);
        return;
      }

      toast.success(`已更新${fields.name.trim()}的資料`);
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("儲存失敗，請重試");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        編輯
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>編輯成員</DialogTitle>
            <DialogDescription>修改姓名、學號、系級或信箱；同一個信箱的所有身份會一起更新。</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-person-email">學校信箱</Label>
              <Input
                id="edit-person-email"
                type="email"
                autoComplete="off"
                value={fields.email}
                onChange={(e) => setFields((f) => ({ ...f, email: e.target.value }))}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-person-name">姓名</Label>
              <Input
                id="edit-person-name"
                autoComplete="off"
                value={fields.name}
                onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
                disabled={pending}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-person-student-id">學號</Label>
                <Input
                  id="edit-person-student-id"
                  autoComplete="off"
                  inputMode="numeric"
                  value={fields.studentId}
                  onChange={(e) => setFields((f) => ({ ...f, studentId: e.target.value }))}
                  disabled={pending}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-person-dept-year">系級</Label>
                <Input
                  id="edit-person-dept-year"
                  autoComplete="off"
                  placeholder="例：資科三"
                  value={fields.deptYear}
                  onChange={(e) => setFields((f) => ({ ...f, deptYear: e.target.value }))}
                  disabled={pending}
                />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>取消</DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? "儲存中…" : "儲存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
