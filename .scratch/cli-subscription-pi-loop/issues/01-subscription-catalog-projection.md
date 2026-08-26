# 01 — 訂閱 catalog 純投影模組 + smoke

Status: resolved
Spec: `.scratch/cli-subscription-pi-loop/spec.md`

## What to build

本 effort 的**核心測試接縫**。新純模組（建議 `src/agent/subscriptionCatalog.ts`）把兩項 fixture-able 事實投影成訂閱 provider catalog：

- 輸入 A：OAuth 同步狀態——即 Host snapshot config 既有的 `oauthImportedProviders` / `oauthSkippedProviders` / `oauthConflicts`。
- 輸入 B：某 native provider 的可用模型列表（ModelRuntime `getModels(providerId)` 的形狀：id / label / contextWindow / reasoning）。

輸出 bounded catalog：每個支援的訂閱 provider（`openai-codex`、`anthropic`）一筆 `{ id, availability: 'available' | 'unavailable' | 'conflict', reason?, models: [...] }`。fail-closed 判定只活在這裡：conflict 名單命中 → `conflict`；未匯入且無憑證 → `unavailable`；其餘才 `available`。provider id 與 model id 字典序排序、模型數有明確上界。模組禁止 import Electron / zustand / `window.`，禁止 `Date.now` / `Math.random`（比照既有投影 smoke 的純度 drift guard）。隨票新增 fixture smoke 掛進 `smoke` 鏈，並附原始碼純度斷言。

**Blocked by:** None — can start immediately

## Acceptance criteria

- [x] 投影模組輸入輸出如上；三種 availability 判定各有 fixture 斷言
- [x] conflict 命中的 provider 永不出現為 available；reason 欄位攜帶人類可讀繁中說明
- [x] 輸出序列化結果不含任何 credential 形狀欄位（access/refresh/accountId 樣式鍵）
- [x] 排序確定、數量有上界；超上界的 fixture 被截斷且可見（modelTotal 欄位）
- [x] Smoke 直接 import 出貨模組驗證；含原始碼純度 drift guard（禁 Electron/zustand/window/Date.now/Math.random/node:）
- [x] Smoke 掛進 `app/package.json` 的 smoke chain（排在 `smoke-reattach-reconcile` 之後）

## Comments

**Implemented and verified.**

落地為 `app/src/agent/subscriptionCatalog.ts` + `app/scripts/smoke-subscription-catalog.mts`。

語意決策記錄：

- **skipped ≡ 有憑證**：`syncPiCliOAuth` 的 skip 代表 Pi 已持有相等或較新憑證，provider 維持可用；只有 conflict 才擋。
- **有憑證但零模型 → unavailable**：誠實呈現「無法使用」，不渲染空下拉。
- **bounding 上界 32**（`SUBSCRIPTION_CATALOG_MAX_MODELS`），截斷以 `modelTotal` 揭示。
- 輸出欄位形狀即安全邊界：credential 形狀資料無路可入，序列化斷言守住。
- 離線／快取語意屬 Host 呼叫端（02）的 reason 注入，投影模組保持無網路概念。

驗證：`node --experimental-strip-types scripts/smoke-subscription-catalog.mts` 全綠、`npx oxlint` 乾淨、`npx tsc -b` exit 0。
