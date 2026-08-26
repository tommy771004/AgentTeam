# 04 — 模型列舉整合 + fail-closed 狀態呈現

Status: resolved
Spec: `.scratch/cli-subscription-pi-loop/spec.md`

## What to build

讓訂閱連線選得到模型、壞狀態看得見。SettingsPage 的模型下拉在訂閱 provider 時改讀 snapshot `config.subscriptionCatalog` 的 `models`（不再呼叫 `window.subagents.llm.models`）；每列顯示 label、context window、reasoning。Fail-closed 呈現消費 01 投影輸出，UI 不重判；model id 原樣傳遞。

**Blocked by:** 03 ✅

## Acceptance criteria

- [x] 訂閱 provider 的模型清單來自 Host catalog；`llm.models` 呼叫路徑對訂閱值不被觸發
- [x] 三種 availability 的呈現各有對應 UI 行為；conflict 無任何可選項
- [x] model id 原樣傳遞（drift guard 斷言無正規化）
- [x] 選定訂閱模型後 `piHost.health()` 測試連線路徑正常（Electron production）
- [ ] 手動驗證記錄：真實 CLI 登入機器上完成一次訂閱 run 端到端 → **移交 06 qualification**（session 中已有一次意外活體證明：`SUBAGENTS_PI_SYNC_CLI_OAUTH=true` 污染環境下，隔離 dir 匯入真實 codex OAuth 後 Pi loop 實際回答成功）

## Comments

**Implemented and verified.**

落地：

- `src/components/settings/SubscriptionModelPicker.tsx`：只讀 `config.subscriptionCatalog`；`available` → select（label · ctx · reasoning），目錄外既有 id 誠實標示「⚠︎ 不在目前目錄」仍可見；`unavailable`/`conflict` → 停用 select＋投影 reason 原文轉述（conflict 加解決指引）；Host 未就緒／無 catalog／未知 provider → 全部 fail-closed 停用，不發明選項。onChange 直接寫 `e.target.value`——零正規化。
- SettingsPage 預設模型區塊分支：訂閱走 picker，OpenAI 相容維持原 input+datalist。
- settingsStore `testConnection`：瀏覽器路徑對訂閱值提前 fail-closed 回「訂閱連線由 Pi Core Host 提供；此環境沒有 Host。」Electron production 路徑本就先走 `piHost.health()` 不受影響。
- Drift guards（掛進 `smoke-subscription-catalog.mts`）：picker 檔禁 `llm.models`/大小寫轉換/別名改寫 regex；必含 `config.subscriptionCatalog` 與 verbatim onChange；piProduction 保持 `model: 'model'` 恆等映射；store 含訂閱 testConnection guard。

驗證：三支 subscription smoke＋owners smoke 全綠；`tsc -b`=0；oxlint 乾淨。
