"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { identityId, type Identity } from "@/domain/access";
import { switchIdentity } from "@/server/actions/identity";

// 頁首身份切換（規格 §14 第 3 點）：只有一個身份時不顯示。選了另一個身份 → switchIdentity()
// 在伺服器設定 cookie ftl_identity 並導到那個身份的首頁（redirect 由 server action 處理）。
export function IdentitySwitcher({ identities, activeId }: { identities: Identity[]; activeId: string }) {
  const [pending, startTransition] = useTransition();
  if (identities.length <= 1) return null;
  const active = identities.find((i) => identityId(i) === activeId) ?? identities[0];

  function choose(id: string) {
    if (id === activeId) return;
    startTransition(async () => {
      try {
        await switchIdentity(id);
      } catch (e) {
        // redirect() 在 server action 裡是用例外實作的，Next 會自己處理，不是真的錯誤。
        if (e instanceof Error && e.message.includes("NEXT_REDIRECT")) throw e;
        toast.error("切換身份失敗，請重試");
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            className="h-9 max-w-[11rem] px-3 text-sm sm:max-w-[16rem]"
          />
        }
      >
        <span className="truncate">身份：{active.label} ▾</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuRadioGroup value={activeId} onValueChange={(value) => choose(String(value))}>
          {identities.map((i) => (
            <DropdownMenuRadioItem key={identityId(i)} value={identityId(i)} className="py-2 text-sm">
              {i.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
