# 08 — 裸殼路由退役

**What to build:** 從舊版連結（例如 Handoff 匯出文件裡引用的失敗頁網址）進來的使用者，會被導回首頁而不是撞上一個沒有入口、與現行對話流程脫節的裸殼畫面。三個裸殼路由改為 redirect，對應的頁面檔案刪除。此票必須在「調整參數重跑」已經在對話內可用之後才做，否則會刪掉唯一的參數重跑入口。

**Blocked by:** 07

**Status:** resolved

- [x] `/execution`、`/success`、`/failed` 皆 redirect 回首頁（不留白屏、不留死頁）
- [x] 三個對應頁面檔案刪除，全庫 grep 無殘留引用
- [x] 參數重跑能力已完全由對話內動作區提供，沒有功能淨損失
- [x] slash 導航指令與側欄／選單入口回歸確認
- [x] smoke（純邏輯）：redirect 對照表

## Answer

`/execution`、`/success`、`/failed` 改 `<Navigate to="/" replace />`；`ExecutionPage`／`SuccessPage`／`FailedPage` 刪除；`Layout` 的 bareShell 分支一併移除（那三條路徑現在走一般 chrome）。失敗頁唯一獨有的能力（參數覆寫重跑）已由 ticket 07 在對話內提供，無功能淨損失。slash `/failed`／`/bug` 早已導向 `/records?tab=logs`，不受影響。
