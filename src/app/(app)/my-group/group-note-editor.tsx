"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateGroupNote } from "@/server/actions/group-note";
import { MAX_GROUP_NOTE_LENGTH } from "@/domain/group-note";
import { formatTaipei } from "@/domain/time";

// 組別備註編輯欄（規格 §14 第 6、7 點）：任一屬於這組的專案生身份都可以改，記錄最後修改者與
// 時間。跟 checkin-dialog.tsx 同一套 pending／error 模式，但這裡是就地編輯（不是彈窗）。
export function GroupNoteEditor({
  note,
  updatedBy,
  updatedAt,
}: {
  note: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const length = [...value].length;

  async function onSave() {
    setError(null);
    setPending(true);
    try {
      const result = await updateGroupNote(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("已更新組別備註");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="group-note" className="text-sm font-medium text-foreground">
        組別備註
      </label>
      <Textarea
        id="group-note"
        value={value}
        disabled={pending}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {length}/{MAX_GROUP_NOTE_LENGTH}
        </span>
        {updatedBy && updatedAt ? (
          <span className="text-xs text-muted-foreground">
            最後由 {updatedBy} 於 {formatTaipei(updatedAt)} 更新
          </span>
        ) : null}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="button" onClick={onSave} disabled={pending} className="self-start">
        {pending ? "儲存中…" : "儲存"}
      </Button>
    </div>
  );
}
