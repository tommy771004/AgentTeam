# 03 — Composer 基礎／進階分層

**What to build:** 一般使用者打開新對話時，composer 只有輸入框與少數常駐控制（附件、聽寫、送出／停止、Approval Mode、模型）。Loop Pattern、執行引擎、思考深度、Build/Plan 收進一個預設收合的「進階」區；展開後全部控制力都在，語義與預設值與現在完全相同（Auto loop、builtin 引擎）。展開／收合狀態被記住（per-app，不隨對話切換重置），下次開新對話沿用上次偏好。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 預設收合時只見基礎列；既有進階選項全部仍可在展開後使用，選項語義與預設值不變
- [x] 展開／收合偏好持久化，重載 app 與新開對話都沿用
- [x] 鍵盤可達：折疊區觸發器與內部控制皆可 Tab 進入並有可見 focus 樣式
- [x] Build/Plan 的 Tab 快捷切換（空輸入時）行為不變
- [x] 元件測試涵蓋折疊互動與偏好持久化

## Answer

新增 `ComposerAdvanced` 折疊區（Build/Plan、Loop Pattern、執行引擎、推理程度、速度），偏好存於新 `composerUiStore`（`subagents:composer.ui.v1`，per-app）。`ComposerQuickActions` 縮回「加東西進來」；`ModelDepthMenu` 更名 `ModelMenu` 且只管模型（深度/速度移入折疊區，不重複擺同一個控制）；模型相依的可用深度抽成 `agent/composerLayering.allowedDepthsFor`（查不到時回全部，不把使用者鎖在單一深度）。收合時觸發器顯示「loop · 引擎 · 深度」摘要。`Icon` 新增 `aria-hidden` 直通——ligature 字型的字面（`track_changes`）本來會被讀進可及性名稱。6 個元件測試。
