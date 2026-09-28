"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { updateGroupNote } from "@/server/actions/group-note";
import { MAX_GROUP_NOTE_LENGTH, validateGroupNote } from "@/domain/group-note";
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

  // Fix round 1 F3：兩個情況都要把文字框同步回「真正存進資料庫的值」，不能只信任本地打字時的
  // value——(1) 剛存檔成功時，資料庫存的是 trim 過的值（可能跟輸入框裡的內容不一樣，例如打了
  // 前後空白）；(2) `note` prop 換了（例如另一個組員也改了備註，這裡 router.refresh() 之後
  // 拿到新的 prop，或父層本來就換了一組不同的資料），文字框要跟著換，不能停在舊的本地 state。
  useEffect(() => {
    setValue(note ?? "");
  }, [note]);

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
      // validateGroupNote 跟 server action 用同一份 trim／空白存 null 規則，這裡直接算出
      // 「剛剛實際存進資料庫的值」，不用等 router.refresh() 之後新的 note prop 才同步。
      const saved = validateGroupNote(value);
      setValue(saved.ok ? (saved.note ?? "") : value);
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
        {/* Fix round 1 F4：超過 200 字時計數器變成 --danger 紅色，存檔前就先提示，不用等按下
            「儲存」才看到錯誤文字。 */}
        <span
          className={
            length > MAX_GROUP_NOTE_LENGTH
              ? "font-mono text-xs text-[color:var(--danger,#B3261E)]"
              : "font-mono text-xs text-muted-foreground"
          }
        >
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
