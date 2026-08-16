# 07 — 首次設定精靈骨架與狀態機

**What to build:** 精靈 overlay 的完整骨架：步驟狀態機（選路徑：內建 LLM／外部 CLI → 憑證 → 測試連線 → 完成），可上一步／跳過；全新 profile（未完成且未跳過）首次啟動自動出現；完成／跳過狀態持久化於 UI 偏好。本票的「測試連線」可用占位結果，與橫幅的重開整合由 08 做。

**Blocked by:** 01

**Status:** resolved

- [x] 全新 profile 啟動自動出現精靈；已處理過的不再自動出現
- [x] 狀態機步驟推進／回退／跳過正確，狀態持久化
- [x] Esc／關閉等同跳過，不留下壞狀態
- [x] 元件測試：步驟流與跳過路徑

## Answer

`src/components/FirstRunWizard.tsx`（掛於 Layout，全頁可用）：步驟狀態機 path→llm/cli→test→done，上一步／跳過（稍後再說、右上關閉、Esc 皆同跳過）；狀態持久化 `subagents.firstRunWizard.state.v1`（completed/skipped）。LLM 路徑填金鑰即 `update({enabled, apiKey})`；CLI 路徑引導至設定→CLI 授權；測試步驟直接重用 `settingsStore.testConnection()`（與設定頁同一條路徑，非占位）。關鍵設計：可見性在 mount 時凍結（`initiallyVisible`），精靈進行中引擎轉可用（填完金鑰）不中途消失、仍走完連線驗證；mount 時已有可用引擎者靜默標記 completed 不打擾。元件測試 7 案（自動出現、completed/skipped 隱藏、引擎可用靜默完成、步驟前進回退、金鑰寫入 store、測試通過才可完成→開始使用寫 completed、跳過與 Esc）。`npm test` 18 passed、`tsc -b` 綠。
