# 02 — 共用 ConfirmSheet 與 rewind 確認一致化

**What to build:** 使用者在對話中對自己的訊息按「回捲」時，看到的是與全 app 一致的 styled 確認面板（同樣的面板底色、邊界、按鈕語彙、Esc/焦點行為），而不是作業系統的原生對話框。取消不做任何事；確認才執行回捲並截斷後續對話。此確認面板為共用元件，之後的票可直接沿用。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] rewind 確認改為共用 styled 面板，畫面語彙與既有 modal sheet 一致
- [x] 面板可用 Esc 取消、焦點進入面板、確認鍵盤可達（純鍵盤可完成整流程）
- [x] 取消時不呼叫 rewind；確認時行為與原本一致（截斷 + 檔案還原語意不變）
- [x] 元件測試涵蓋「取消不觸發 rewind」「確認觸發一次 rewind」
- [x] 全庫不再有 rewind 路徑的原生 `confirm()` 呼叫

## Answer

新增共用 `ConfirmSheet`（沿用 PermissionAskModal 的 overlay／card／footer token：ghost 取消 + 實心確認，非 fill/outline 配對），rewind 改用之，`window.confirm` 於 rewind 路徑歸零。鍵盤契約抽成 `hooks/useDialogKeys`（Esc 關閉 + Tab 在面板內循環），與 `AutomationCreateSheet` 共用。11 個元件測試涵蓋取消/確認/Esc/背景點擊/busy 鎖定，以及「確認只觸發一次 rewind 且帶正確 bubbleId」。
