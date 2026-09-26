// 最小佔位頁：讓 /dashboard 這條路由真正存在，才會經過 (app)/layout.tsx 的 requireOk() 權限檢查。
// 真正的幹部看板畫面在之後的 Task 才會實作。
export default function DashboardPlaceholder() {
  return null;
}
