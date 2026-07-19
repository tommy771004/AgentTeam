# 08 — 完成訂閱、裝置啟用與離線寬限

**What to build:** Let an individual buy, activate, use, cancel, and recover a predictable fixed-seat Pro subscription without sending project content to the service.

**Blocked by:** 07 — 建立 Free Core Entitlement Boundary.

**Status:** 已完成（產品端；官網 checkout 入口由 13 銜接）

- [x] US$9/month and US$90/year subscription options are represented by the product and website checkout flow.
- [x] Successful purchase activates a Pro entitlement for a bounded number of user devices.
- [x] The app can refresh entitlement state without uploading source code, prompts, transcripts, or Handoff content.
- [x] A documented offline grace period permits local work during temporary network loss.
- [x] Expiry, cancellation, refund, device removal, and reactivation states are handled explicitly.
- [x] Expired or cancelled Pro stops future paid downloads while preserving Free Core and existing local data.
- [x] Account, payment, webhook, and entitlement failures produce actionable user-facing messages.

**Implementation notes (2026-07-19):**
- `app/src/agent/subscription.ts` — layers on issue 07's `entitlement.ts` (never reimplements `resolveEntitlement`):
  - `SUBSCRIPTION_PRICING`（monthly US$9 / annual US$90）。
  - `activateDevice` / `removeDevice`：`maxDevices`（預設 3）上限的裝置啟用，重複啟用同裝置為 idempotent，非額外佔用席次。
  - `applyLifecycleEvent`：cancel/expire/refund/reactivate 的顯式 total 狀態機（cancel 需從 active；reactivate 從 refunded 明確拒絕，需重新購買；expire/refund 清空裝置）。
  - `isWithinOfflineGrace` + `resolveEntitlementWithGrace`：check-in 週期（7 天）+ 離線寬限（72 小時）；超過寬限即 fail-closed 回 free（Free Core 不受影響），沒有 grace 就不合法地延長授權。
  - `buildEntitlementRefreshRequest`：白名單型別（licenseId/deviceId/deviceSignature/appVersion），任何 source/prompt/transcript/handoff 欄位都不在型別內，smoke 以 regex 防呆。
  - `describeSubscriptionFailure`：account/payment/webhook/entitlement-refresh 四類，皆附「Free Core 不受影響」安撫文字。
- `app/src/store/subscriptionStore.ts` — zustand store，本機持久化裝置/生命週期狀態，`entitlement` 欄位透過 `resolveEntitlementWithGrace` 得出（issue 07+08 合併決策點）；`refresh(fetcher)` 用注入的 transport function，不預設任何特定後端。
- `app/src/pages/SettingsPage.tsx`「方案」群組新增：非 active 狀態時顯示取消/退款/未訂閱說明與「查看方案」外部連結（`subagents.ai/pricing`，沿用既有 `shell.openExternal` 安全機制）；active 時列出已啟用裝置與移除按鈕；`lastError` 顯示為可行動的警示訊息。
- Checkout 的官網下單流程本身在本 repo 之外（無 website 專案），由依賴本 issue 的 13 銜接 entry point；本 issue 完成產品端可獨立驗證的定價呈現、裝置啟用、生命週期、離線寬限與失敗訊息。
- 驗證：`app/scripts/smoke-subscription.mts`（9 groups：定價、裝置上限與收回席次、refresh 白名單、offline grace 邊界、生命週期狀態機、過期後 Free Core 與本機資料不受影響、可行動失敗訊息、Settings UI seam、store 透過 grace-aware boundary）；wired into `npm run smoke`、`smoke:ci`，新增 `npm run smoke:subscription`。`tsc -b` 與 `npm run smoke` 全綠。
