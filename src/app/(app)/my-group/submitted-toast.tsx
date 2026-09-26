"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// 交件頁送出成功後帶著 ?submitted=1 回到組頁；這裡用 toast 顯示一次性的提示，
// 顯示完就把參數從網址拿掉，重新整理或分享這個連結不會再跳出來。
export function SubmittedToast() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // React 開發模式下 effect 會 mount 兩次（StrictMode），用 ref 擋掉第二次，
  // 避免使用者看到兩個一樣的 toast。
  const shown = useRef(false);

  useEffect(() => {
    if (searchParams.get("submitted") === "1" && !shown.current) {
      shown.current = true;
      toast.success("已送出，2 小時內可以修改");
      router.replace("/my-group");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在掛載、或 query 變動時跑一次
  }, [searchParams]);

  return null;
}
