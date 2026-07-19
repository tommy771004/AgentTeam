# 07 — 建立 Free Core Entitlement Boundary

**What to build:** Make the Free Core useful without login while giving every future paid capability one consistent entitlement decision point.

**Blocked by:** None — can start immediately.

**Status:** 已完成

- [x] The app starts and completes baseline local coding tasks without a subscription or account.
- [x] Free Core includes local provider/CLI connections, projects, sessions, basic multi-agent use, Plan/Goal tasks, permissions, skills/MCP, diff/terminal/history, export, and Handoff.
- [x] Paid capability checks resolve through one entitlement boundary rather than scattered feature-specific flags.
- [x] An unavailable or malformed entitlement fails closed for paid features without blocking Free Core launch.
- [x] Existing local data remains readable and exportable regardless of entitlement state.
- [x] Free and entitlement-denied behavior is covered through UI and runtime seams.

**Implementation notes (2026-07-19):**
- `app/src/agent/entitlement.ts` — the one decision point: `resolveEntitlement(raw)`（pure、total，undefined/null/malformed/expired 全部 fail-closed 到 `tier:'free'`，不 throw）、`isFeatureEntitled(snapshot, featureId)`、`isCapabilityEntitled(snapshot, requiresEntitlement?)`（無 `requiresEntitlement` = Free Core，永遠不查）。
- `app/src/agent/capabilities/types.ts` — `AgentCapability.requiresEntitlement?: string`；`app/src/agent/capabilities/runtime.ts` `assembleCapabilities` 在組出 `all` 後立刻用 `isCapabilityEntitled` 過濾，未授權的付費 capability 完全不會進入 catalog（不是禁用/灰階，而是不存在）— 這是未來所有付費 capability 必經的 runtime seam，取代零散的 feature flag。
- `app/src/store/entitlementStore.ts` — zustand store，`snapshot` 預設從 `localStorage['subagents:entitlement']`（不存在/壞掉都安全 fallback 到 free）經 `resolveEntitlement` 得出；`isEntitled(featureId)` 是 UI/引擎共用的單一檢查點；`refresh(raw)` 供未來訂閱／裝置離線寬限（issue 08）、簽章功能包（issue 09）重新解析用。
- `app/src/pages/SettingsPage.tsx` — 一般設定新增「方案」群組，顯示目前 tier（Free Core / Pro）與（若為付費）已授權功能清單，UI seam 直接讀 `useEntitlementStore`。
- `app/src/agent/settingsExport.ts` 未變動、且刻意不引用 entitlement —匯出/遮罩邏輯與方案狀態完全無關，證明本機資料在任何 entitlement 狀態下都可讀取與匯出。
- 驗證：`app/scripts/smoke-entitlement.mts`（7 groups：free-by-default、valid paid 解析、malformed/expired fail-closed、runtime seam 判斷式、export 不受影響、runtime.ts / types.ts / SettingsPage.tsx / entitlementStore.ts 的 source drift guard）；wired into `npm run smoke`、`smoke:ci`，並新增獨立 `npm run smoke:entitlement`。`tsc -b` 與 `npm run smoke` 全綠。
