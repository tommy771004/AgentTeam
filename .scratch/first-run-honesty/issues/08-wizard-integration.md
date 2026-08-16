# 08 — 精靈與橫幅／連線測試整合

**What to build:** 把 07 的精靈接上真實世界：精靈的「測試連線」重用設定頁既有的連線測試能力（不重寫、不旁路 Pi settings 的實際路徑）；精靈完成後 03 的橫幅即時消失；橫幅提供「開啟精靈」重開入口（跳過過的人隨時可回來），設定頁也有重開入口。

**Blocked by:** 03, 07

**Status:** resolved

- [x] 精靈內測試連線的結果與設定頁測試一致（同一條路徑）
- [x] 完成精靈 → 橫幅消失；跳過 → 橫幅仍在且可重開精靈
- [x] 橫幅與設定兩處都有重開入口
- [x] 元件測試：完成／跳過兩條整合路徑

## Answer

`reopenFirstRunWizard()` 匯出函式：清除 localStorage 狀態＋廣播 `subagents:first-run-wizard:reopen` 事件；FirstRunWizard 監聽後重置步驟／草稿並以 `forcedOpen` 顯示（不受 mount 時凍結的 initiallyVisible 限制）。入口兩處：橫幅次要按鈕「開啟設定精靈」、設定→語言模型「重新執行首次設定精靈」。測試連線一致（T07 已直接重用 `settingsStore.testConnection`）。完成→引擎可用→橫幅自動消失（推導驅動）；跳過→橫幅在且可重開。元件測試新增 2 案（reopen 事件重開、橫幅點擊重開整合），共 20 passed、`tsc -b` 綠。
