# 03 — Simulation／未設定警示橫幅

**What to build:** 首頁 composer 上方常駐警示橫幅：當 02 的推導判定「沒有任何可用引擎」時顯示，文案誠實說明「目前任務將以本地模擬策略執行（不會有真實模型輸出）」，附「前往設定」CTA 直達語言模型節；任一引擎可用時即時消失。視覺沿用既有 amber 警示語言，尊重 reduced-motion。

**Blocked by:** 01, 02

**Status:** resolved

- [x] 無語言模型且無任何已授權 CLI 時橫幅可見；任一可用即隱藏
- [x] CTA 導向設定頁的語言模型節
- [x] 元件測試：條件渲染（顯示/消失）與 CTA 導向
- [x] 樣式與動效納入既有警示視覺與 reduced-motion 規範

## Answer

`src/components/EngineAvailabilityBanner.tsx`：讀 settingsStore → `deriveEngineAvailabilityFromSettings(settings, null)` → `bannerVisible` 才渲染；amber 視覺沿用 Layout 既有警示語言（`bg-amber-500/15` 系）＋`macos-enter`（受 data-reduced-motion 規範）。CTA `navigate('/settings?section=llm')`；SettingsPage 新增 `?section=` 深連結（無效節 id 回一般節，未來 palette 共用）。掛載於 ProtocolsPage composer 區塊頂（ProjectContextBar 上方），空狀態與對話狀態都可見。元件測試 3 案（顯示、CTA 導向、CLI/金鑰可用時消失；zustand `setState` 驅動）。setup.ts 補 `afterEach(cleanup)`（globals: false 時 RTL 不自動清理）。驗證：`npm test` 6 passed、`tsc -b` 綠、oxlint 對新檔 0 errors（3 warnings 為 SettingsPage:510 既有）。
