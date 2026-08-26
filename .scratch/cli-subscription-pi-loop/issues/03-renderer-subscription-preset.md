# 03 — Renderer 訂閱 preset 面 + settings 映射

Status: resolved
Spec: `.scratch/cli-subscription-pi-loop/spec.md`

## What to build

讓使用者選得到訂閱連線。`src/agent/types.ts` 的 `ApiProviderPreset` 擴充 `'openai-codex' | 'anthropic'`；`API_PROVIDER_PRESETS` 新增對應兩筆定義——`baseUrl` 為空、無 defaultModel、note 說明憑證來源是 CLI 登入同步。SettingsPage 對這兩個 preset 值隱藏 baseUrl / apiKey / 「測試連線列出模型」的 OpenAI 相容欄位與流程；渲染同步狀態區塊。

**Blocked by:** 02 ✅

## Acceptance criteria

- [x] `ApiProviderPreset` 含兩個新值且 presets 各有一筆；型別層無 any 逃逸
- [x] 選訂閱 provider 後送出的 piHost settings patch 只含 `provider`/`model`，不含 `apiKey`/`baseUrl`
- [x] SettingsPage 對訂閱 provider 不渲染 baseUrl/apiKey 輸入欄；渲染同步狀態區塊
- [x] 切換回 OpenAI 相容 preset 時既有行為完全不變（回歸斷言）
- [x] `npm run build`（typecheck）與 `npx oxlint src` 通過

## Comments

**Implemented and verified.**

落地：

- `src/agent/types.ts`：`ApiProviderPreset` 加 `'openai-codex' | 'anthropic'`。
- `src/agent/apiProviders.ts`：兩筆 preset 定義（baseUrl/defaultModel 空、note 揭露「Pi loop 執行（非 vendor agent）」與訂閱條款限流）；`SUBSCRIPTION_PROVIDER_PRESETS` + `isSubscriptionProviderPreset()`。
- **剝離 owner 收斂到單點**：`piSettingsPatchFromLlmSettings`（`src/agent/piProduction.ts`)在 apiProvider 為訂閱值時直接跳過 `baseUrl`/`apiKey` 兩鍵——連空字串都不送，Host 的 legacy endpoint persist 無從 latch 到訂閱 provider。settingsStore 不重複實作。
- `src/pages/SettingsPage.tsx`：訂閱分支不寫 baseUrl/model 清空；Base URL／API 金鑰欄位與「驗證模型能力」按鈕條件隱藏；新增 `<SubscriptionConnectionStatus />` 讀 snapshot `config.subscriptionCatalog` 渲染每列 verdict＋reason＋揭露文案。
- `src/components/settings/SubscriptionConnectionStatus.tsx`：只消費 availability metadata；舊 protocol Host（無 catalog）不渲染、不發明列。型別直接 import 純模組（非鏡像），單一事實源。
- `electron/preload.ts` 鏡像型別補 `subscriptionCatalog?`。

驗證：`smoke-pi-production-owners.mts` 新增行為斷言（訂閱 patch 只含 provider/model；OpenAI 相容回歸不變）＋全綠；`tsc -b` exit 0；oxlint 乾淨；**乾淨環境全鏈 `npm run smoke` 99 支全過**。
