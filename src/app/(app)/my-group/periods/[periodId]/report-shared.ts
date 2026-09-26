import type { Light } from "@/domain/lights";

// progress-form.tsx（第一次交）與 editable-report.tsx（2 小時內修改／換 PDF）共用的東西，
// 放一份就好，改燈號說明或上傳錯誤文字時不會只改到其中一邊。

export const LIGHT_OPTIONS: { value: Light; label: string; hint: string }[] = [
  { value: "green", label: "綠燈", hint: "進度正常" },
  { value: "yellow", label: "黃燈", hint: "有點落後，還在掌控中" },
  { value: "red", label: "紅燈", hint: "卡關，需要幫忙" },
];

// 用 XMLHttpRequest（不是 fetch）直接 PUT 到預簽網址：fetch 拿不到上傳進度。
export function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) onProgress(Math.round((evt.loaded / evt.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("上傳失敗，請重試")));
    xhr.onerror = () => reject(new Error("上傳失敗，請重試"));
    xhr.send(file);
  });
}
