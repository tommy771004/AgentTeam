# 10 — Command Palette UI

**What to build:** 全域 Command Palette overlay：快速鍵呼出（預設 chord 不與現有全域快捷鍵衝突、納入可重設快捷鍵機制）、搜尋框 + 結果清單 + 完整鍵盤導航（上下／Enter／Esc），資料來自 09 的共用註冊表；命中設定節時跳轉至對應錨點。任何頁面（含浮動 console 場景）都可用。

**Blocked by:** 09

**Status:** resolved

- [x] 任意頁面可呼出，Esc 關閉，焦點管理與還原正確
- [x] 鍵盤全程可用；chord 進入可重設快捷鍵設定
- [x] 命中條目可執行動作／導航／跳設定錨點
- [x] 元件測試：過濾、鍵盤導航、執行

## Answer

`shortcutStore` 新增 `commandPalette`（預設 ⌘⇧P，chordMatches 支援 shift 組合；設定快捷鍵節自動渲染可重設）。`paletteStore`（開合狀態）＋`useGlobalShortcuts` 掛 chord；`CommandPalette.tsx` 掛於 Layout（全頁含浮動 console 場景）：資料 `getAllCommandEntries()`＋`filterCommandEntries()`（T09 共用層），↑↓ 循環選擇、Enter 執行（navigate/settings 直接跳轉含 `?section=` 深連結；slash 條目帶 `/name ` 回 composer）、Esc 關閉、開啟聚焦輸入＋關閉還原原焦點、結果上限 40。元件測試 4 案（顯示/聚焦/Esc、fuzzy 過濾、鍵盤導航 Enter 導航、設定深連結）。`npm test` 24 passed、`tsc -b` 綠。
