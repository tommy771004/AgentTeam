# 01 — 死檔清理（未被路由的頁面與樣板殘留樣式）

**What to build:** 維護者從程式庫拿掉四個已經沒有任何路由或元件引用的頁面檔案，以及 Vite 專案樣板殘留、沒有被任何模組 import 的 root 樣式檔。使用者看得到的行為完全不變——所有既有導航（含已改為 redirect 的舊路徑）維持原狀；改變的只有維護面積。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 四個未被路由引用的頁面檔案移除，全庫 grep 無殘留 import
- [x] 未被 import 的樣板殘留樣式檔移除，畫面樣式無變化
- [x] 既有導航與 redirect 行為不變（自動化、記錄、日誌等入口逐一確認）
- [x] `npm run build`、`npm run smoke`、元件測試維持全綠

## Answer

`ArchivePage`／`EventsPage`／`LogsPage`／`SchedulerPage`（皆無任何路由或元件引用）與未被 import 的 Vite 樣板 `src/App.css` 移除。`/scheduler`、`/events`、`/archive`、`/logs` 的既有 redirect 與側欄入口不變。順手把 `smoke-caps.mjs` 三處硬編頁面清單改為 `listRunEntrySurface(fs)` 從磁碟列舉 renderer 入口面（pages/hooks/components/hermes），drift guard 不再因刪檔而失效，也涵蓋未來新增的頁面；「呼叫 runTask 就必須從 taskRunCoordinator 取得」改為對真的呼叫 runTask 的檔案斷言。
