# 05 — 誠實標示 drift guards

Status: resolved
Spec: `.scratch/cli-subscription-pi-loop/spec.md`

## What to build

契約化 ADR-0052 決策 4/5，防兩種漂移：「訂閱 run 被誤呈現為 vendor agent run」與「能力矩陣被特殊化」。三支 source-text guard，指向新 owner、不 inline 重實作、只加強不放寬。

**Blocked by:** 03 ✅

## Acceptance criteria

- [x] 標示 guard 斷言訂閱區塊含 Pi loop 語意文案、不含 vendor agent 宣稱措辭
- [x] 能力矩陣 guard 斷言判定路徑無 provider 特殊分支
- [x] IPC 邊界 guard 斷言 renderer 無 credential 讀取新路徑
- [x] 三個 guard 掛進 smoke chain 且全綠

## Comments

**Implemented and verified.**

落地為 `app/scripts/smoke-subscription-labeling.mts`（已掛進 smoke chain）：

1. **標示 guard**：`apiProviders.ts` 兩筆訂閱 preset note 必含 `Pi loop` 且明確否定語意（`非 Codex agent` / `非 Claude Code`）；兩個訂閱 UI 元件禁出現 vendor agent 宣稱字樣；狀態元件必含「Pi loop + 訂閱模型」揭露文案。
2. **能力矩陣 guard**：`runDispatch.ts` 必含 builtin→loop 與 cli→external 兩條判定原文；禁 `isSubscriptionProviderPreset` / `subscriptionCatalog` / `apiProvider === 'openai-codex'|'anthropic'` 式特殊分支（注意：CLI connector 的 `'claude' → 'anthropic'` 映射是既有合法程式碼，guard 以 apiProvider 精準比對避開誤擊）。`taskRunCoordinator.ts` 禁 provider 感知 import——admission 維持 provider-blind。
3. **IPC 邊界 guard** 分層：新訂閱面檔案（兩元件＋presets）全面禁 credential 形狀字串；既有大面（settingsStore / SettingsPage / piProduction）禁訂閱憑證專屬標記（`auth.json` / `.credentials.json` / `codexOAuthImport|claudeOAuthImport` / `SUBAGENTS_*_AUTH_PATH`）——不禁它們各自既有的外掛 OAuth 功能詞彙。

教訓記錄：guard 對「自己的說明註解」也會誤擊（`auth.json`、`alias` 字樣出現在註解中）——已改寫註解而非放寬 guard，維持對真實程式碼的嚴格性。

驗證：smoke 全綠；`tsc -b`=0；oxlint 乾淨。
