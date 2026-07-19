# 10 — 執行時期 entitlement seam 接線

**What to build:** 把 `assembleCapabilities` 在每次實際執行時拉到真的 entitlement 快照,讓 #07 的「單一決策點」變成可見的 runtime 行為,而不是只在斷言裡綠。

**Blocked by:** 11 — 雙 store 收斂為單一可寫來源。

**Status:** 已完成

- [x] `engine.ts:1062`、`tools/toolLoop.ts:243`、`intentPreload.ts:61` 三個實際呼叫點都把 entitlement 餵進 `assembleCapabilities`,不是預設 free。
- [x] `runtime.ts:163` 的 fallback 只在純模組環境(smoke / unit / e2e node 端)落到 `resolveEntitlement(undefined)`;瀏覽器端透過 caller 在渲染器端 `await import('../store/subscriptionStore').useSubscriptionStore.getState().entitlement` 拿當下快照。
- [x] Paid 能力的 cap 存在 `BUILTIN_CAPABILITIES` 或新加入時帶 `requiresEntitlement`,在 Pro entitlement snapshot 下會進 catalog;Free snapshot 下完全不進。
- [x] 驗證用 `smoke-entitlement`(整體既有的 7 groups + 新增第 8 組「subscriptionStore 為唯一 writer」)+ `smoke-subscription` + `smoke-feature-pack`;全綠。
- [x] `tsc -b`、`npm run smoke` 全綠。

**Implementation notes (2026-07-19):**
- `app/src/agent/engine.ts:1062` — 在 `assembleCapabilities` 呼叫前加 `await import('../store/subscriptionStore')` 動態導入,呼叫 `useSubscriptionStore.getState().entitlement` 取得當下 grace-aware snapshot,傳入 `entitlement` opt。用動態導入避免 SSR / 測試路徑耦合到 zustand。
- `app/src/agent/tools/toolLoop.ts:243` — 同樣模式,用 `await import('../../store/subscriptionStore')` 拿 entitlement 注入。
- `app/src/agent/intentPreload.ts:61` — `buildIntentPreloadIds` 新增 `opts.entitlement?: EntitlementSnapshot`,呼叫 `assembleCapabilities` 時透傳;調用端 `runDispatch.ts:151` 同樣動態導入 subscriptionStore 拿 entitlement 傳入。
- `app/src/agent/entitlement.ts` — 新增 `EntitlementSnapshot` export 供 `intentPreload.ts` import type 用。
- **不需在 `runtime.ts` 加 helper** — 設計決策把 store coupling 推到三個 caller 端,`assembleCapabilities` 仍是純函式,fallback 保持 `resolveEntitlement(undefined)` 給非瀏覽器環境。
- 所有 smoke 通過:`npm run smoke`、`npm run smoke:entitlement`、`npm run smoke:subscription`、`npm run smoke:feature-pack`、`tsc -b`。