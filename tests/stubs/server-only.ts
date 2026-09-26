// 測試環境用的 server-only 替身：真正的 server-only 套件在沒有 "react-server" condition
// 的環境（包含 vitest 的 node 環境）import 就會直接 throw，但單元／整合測試本來就是要在
// node 環境呼叫這些只該在伺服器執行的模組，所以在 vitest.config.ts 把 "server-only" 指到
// 這個空模組，跳過那個檢查。
export {};
