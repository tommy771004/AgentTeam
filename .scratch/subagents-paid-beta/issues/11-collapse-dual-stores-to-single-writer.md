# 11 — 雙 store 收斂為單一可寫來源

**What to build:** `subscriptionStore` 與 `entitlementStore` 兩個 store 同時持有 entitlement 投影,違反 #07「單一檢查點」與 #08「grace-aware 合併決策點」。把 entitlement 變成單一可寫來源,其它只讀投影。

**Blocked by:** None — 可立刻開始。

**Status:** 已完成

- [x] `subscriptionStore` 成為唯一 `state` / `entitlement` 接寫的 store。`refresh`、`activate`、`removeDevice`、`applyLifecycle` 都已寫 `localStorage['subagents:subscription']`,成為唯一可寫接點。
- [x] `entitlementStore` 改為派生 read-only store:`snapshot` 與 `isEntitled` 透過訂閱 `subscriptionStore` 得出,不直接寫 localStorage「`subagents:entitlement`」鍵、不寫自己 snapshot。
- [x] `SettingsPage.tsx`「方案」群組的 tier 顯示單一來自 `useSubscriptionStore.entitlement`,但保留 `useEntitlementStore` 為 re-export,讓其他呼叫點不被打擾。
- [x] grace-aware 邏輯仍只在 `subscription.ts:resolveEntitlementWithGrace` 一處存在。
- [x] `localStorage['subagents:entitlement']` 只在舊資料遷移時讀一次(補 #07 既有保留),不再寫。
- [x] `smoke-entitlement.mts` 「`entitlementStore.ts` 的 source drift guard」改寫為「`subscriptionStore` 為唯一 writer」斷言;測試全綠。

**Implementation notes (2026-07-19):**
- `app/src/store/entitlementStore.ts` — 改為 derived(zustand `create` 仍存在,API 表面 `snapshot` / `isEntitled` 不變)。初值用 `initialSnapshot()`:若 `subscriptionStore.state.lastVerifiedAt` 已存在,直接用 `subscriptionStore.entitlement`;否則一次性 legacy-讀 `localStorage['subagents:entitlement']`(`legacyMigrated` 旗標全行程只跑一次)過 `resolveEntitlement`;都沒有就 `resolveEntitlement(undefined)`。接著 `useSubscriptionStore.subscribe` 訂閱 `entitlement` 變動,mirror 回 `useEntitlementStore.setState({ snapshot })`。`isEntitled(featureId)` 永遠讀 `useSubscriptionStore.getState().entitlement`,不緩存、零重算。
- `app/src/store/subscriptionStore.ts` 沒動;它本來就是唯一 writer(`refresh` / `activate` / `removeDevice` / `applyLifecycle` 都用 `set({ state, entitlement: recomputeEntitlement(state) })`)。
- `app/src/pages/SettingsPage.tsx` 沒動;`useEntitlementStore` 仍是可用 API 但現在是 derived,UI 端可繼續讀。
- `app/scripts/smoke-entitlement.mts` Group 8 新增四條:subscriptionStore 含 `recomputeEntitlement`;entitlementStore 不寫 `subagents:entitlement`(給 legacy migration 例外);entitlementStore 不擁有 `refresh(raw)`;entitlementStore 透過 `useSubscriptionStore.subscribe` 或 `useSubscriptionStore.getState` 衍生。
- 驗證:`tsc -b`、`npm run smoke`、`npm run smoke:entitlement` 都全綠。

**Notes for #10:**
- 三個 runtime site(`engine.ts:1062` / `tools/toolLoop.ts:243` / `intentPreload.ts:61`)仍然沒餵 `opts.entitlement`,這是 #10 的工作。
- 給 #10 的建議接取模式:抽 helper(`readLiveEntitlement() = useSubscriptionStore.getState().entitlement`)放在 `app/src/agent/entitlement.ts` 的瀏覽器端分支;runtime fallback 改用 helper。即 `#10` 不需要再動 store 設計。
