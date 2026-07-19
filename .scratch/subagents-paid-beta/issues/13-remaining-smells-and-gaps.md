# 13 — 其餘 5 項 smell/實作缺口收歸

**What to build:** 將先前審查發現的 5 個殘留項目（非阻礙本批核心功能，但違反基線或專案慣例）集中在一張 ticket，逐項解決或確認例外。

**Blocked by:** None — 可立刻開始。

**Status:** 已完成

- [x] **Duplicated Code：localStorage helper 三份**  
  `app/src/store/entitlementStore.ts`、`subscriptionStore.ts`、`featurePackStore.ts` 三個 `readRawEntitlement / readJson / persist` 同形。  
  → 抽成 `app/src/store/persist.ts` 共用：`readJson(key, { fallback, migrateFrom, migrate? })`、`writeJson(key, value)`、一次性 migration guard (`migrationDone/markMigrationDone`)。`#11` 已把 `entitlementStore` 只保留 legacy migration，其餘兩個 store 改用共用 helper。

- [x] **Primitive Obsession：`requiresEntitlement: string` / `featureId: string`**  
  `entitlement.ts:73,79`、`capabilities/types.ts:59` 到處傳裸字串。  
  → 加 `type FeatureId = string & { readonly __brand: unique symbol }`（`entitlement.ts:14`），在 boundary（`isFeatureEntitled`、`isCapabilityEntitled`、`AgentCapability.requiresEntitlement`、`FeaturePackManifest.requiredEntitlement`）做品牌化。內部仍是字串，型別系統只在編譯期保護。

- [x] **Speculative Generality：`EntitlementSnapshot.failClosed` 可衍生**  
  `entitlement.ts:24` 存 `failClosed: boolean`，但 `source !== 'valid'` 即 `failClosed === true`（`freeSnapshot`、`expired`、`malformed` 皆同）。  
  → 拿掉欄位，改用 getter helper：`isFailClosed(snapshot) = snapshot.source !== 'valid'`（`entitlement.ts:34-36`）；smoke test 第 3、4 組相應改寫。

- [x] **#08 refresh placeholder：`deviceSignature` / `appVersion` 永遠空字串**  
  `subscriptionStore.ts:107-112` `buildEntitlementRefreshRequest` 呼叫時塞空字串。  
  → 在 `SubscriptionState`、`DeviceActivation` 新增 `deviceSignature?`、`appVersion?`（`subscription.ts:25-29, 39`），啟用裝置時寫入，refresh 時帶真實值。若仍無來源，改為 `undefined` 並在 `buildEntitlementRefreshRequest` 型別標記 optional，契約仍 whitelist。

- [x] **Source:'user' 誤標：簽章 feature pack 應有專屬 source**  
  `capabilities/types.ts:44` `source?: 'builtin'|'skill'|'mcp'|'user'`，`featurePacks.ts:188` 仍用 `'user'`。  
  → 新增 `'feature-pack' as const` 進 union（`capabilities/types.ts:44`），`featurePackCapability` 回傳 `source: 'feature-pack'`（`featurePacks.ts:188`）；smoke `smoke-feature-pack.mts` 第 7 組（drift guard）同步檢查 `source === 'feature-pack'`。

**Implementation notes:**
- 每項獨立 PR/提交，跑 `tsc -b`、`npm run smoke` 綠燈才合併。
- `#13.1`、`#13.2`、`#13.3` 可平行；`#13.4` 需動 `subscription.ts` 合約，先確認無外部依賴；`#13.5` 型別擴充要同時改 `capabilities/types.ts`、`featurePacks.ts`、`smoke-feature-pack.mts`。
- 不動 `#10` `#11` `#12` 已完成的功能。

**Verification:**
- `tsc -b`、`npm run smoke`、`npm run smoke:entitlement`、`npm run smoke:subscription`、`npm run smoke:feature-pack` 全綠。