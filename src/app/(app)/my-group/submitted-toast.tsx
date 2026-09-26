"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Fix round 1（controller ruling，root-cause submit-progress.spec.ts 的 flake）：原本是
// 交件頁 router.push("/my-group?submitted=1")，這個元件掛載後再 router.replace("/my-group")
// 把參數拿掉——一次送出因此變成兩次連續的 client-side 導頁。在 `next dev`（尤其是伺服器正在
// on-demand 編譯、比較慢的時候）這兩次導頁會互相競爭：第二個 replace() 常常會取消掉第一個
// push() 還沒完成的 RSC fetch（net::ERR_ABORTED），而 Next dev 在把「這個請求被取消」這件事
// 回報成一個 RSC stream 錯誤、嘗試組一份除錯用的假呼叫堆疊時，會踩到 React 開發版工具鏈自己
// 的 bug（`frame.join is not a function`，只存在於 dev 專用的
// resolveErrorDev／buildFakeCallStack 路徑，production build 完全不會執行這段程式碼），整個
// 客戶端當場崩潰成「Application error: a client-side exception has occurred」——這就是
// submit-progress.spec.ts 大約 1/3 機率在
// `await expect(page).toHaveURL(/\/my-group$/)` 這一步 timeout 的根因（用
// page.on('pageerror') 直接在失敗當下截到這個 TypeError，見 fix round 1 報告）。
//
// 修法：整個流程只做一次導頁。送出成功後直接 push 到乾淨的 "/my-group"（不帶 query
// string），要顯示的「已送出」提示改用 sessionStorage 存一個旗標，這個元件掛載時读一次、
// 顯示完就清掉——效果跟原本一樣（只顯示一次、重新整理或分享網址不會再跳出來），但不再需要
// 第二次導頁，从根本上消除了那個 race window。
const FLAG_KEY = "ftl:submitted-toast";

export function markSubmittedToast() {
  try {
    sessionStorage.setItem(FLAG_KEY, "1");
  } catch {
    // 私密瀏覽模式或封鎖網站資料時 sessionStorage 可能整個不能用；退化成「這次不跳提示」，
    // 不影響送出本身已經成功這件事。
  }
}

export function SubmittedToast() {
  // React 開發模式下 effect 會 mount 兩次（StrictMode），用 ref 擋掉第二次，
  // 避免使用者看到兩個一樣的 toast。
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(FLAG_KEY) === "1";
      if (flagged) sessionStorage.removeItem(FLAG_KEY);
    } catch {
      flagged = false;
    }
    if (!flagged) return;
    shown.current = true;
    toast.success("已送出，2 小時內可以修改");
  }, []);

  return null;
}
