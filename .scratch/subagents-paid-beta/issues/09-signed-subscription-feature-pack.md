# 09 — 交付簽章 Subscription Feature Pack

**What to build:** Let an active subscriber download and safely activate a versioned paid workflow pack while keeping the Free Core recoverable.

**Blocked by:** 02 — 交付 Windows 簽章與 macOS 公證版本; 07 — 建立 Free Core Entitlement Boundary; 08 — 完成訂閱、裝置啟用與離線寬限.

**Status:** 已完成

- [x] A feature-pack manifest declares identity, version, compatibility, permissions, and required entitlement.
- [x] The app verifies pack signature and hash before installation or activation.
- [x] An entitlement denial prevents download and activation without breaking the Free Core.
- [x] Pack installation, update, disable, uninstall, and rollback are supported.
- [x] A failed or incompatible pack cannot strand the application or make local data unreadable.
- [x] Pack audit evidence records version and digest without storing raw secrets or full private prompts.

**Implementation notes (2026-07-19):**
- `app/src/agent/featurePackContracts.ts` — browser-safe manifest contract mirroring `updateContracts.ts`'s signed-manifest pattern (reuses its `canonicalJson`/`compareVersions`, doesn't reimplement): identity/name/version/minAppVersion/maxAppVersion/requiredEntitlement/`artifact`（url/size/sha256/signature/signatureAlgorithm，同 update artifact descriptor）/publishedAt/signature；`permissions` 直接複用既有 `tools/toolPackage.ts` 的 `ToolPackageManifest`（每個 tool 必須宣告 operationClass），不重新發明權限模型。`validateFeaturePackManifest` 白名單欄位＋相容性檢查（appVersion vs minAppVersion/maxAppVersion）。
- `app/electron/featurePackVerification.ts` — 純包一層：直接呼叫既有 `updateVerification.ts` 的 `verifyDetachedSignature`/`sha256Hex`（issue 05 已驗證過的簽章／雜湊邏輯），不重寫任何 crypto。
- `app/src/agent/featurePacks.ts` — 生命週期（mirrors `openDesign/packs.ts`）：`packMayActivate`（entitlement + compatibility 單一閘門，下載前與啟用前都經過此檢查）、`installFeaturePack`（`verified=false` 一律拒絕，既有版本不受影響）、`disable/enable/uninstall/rollback`（`previousManifest` 保留供回復）、`featurePackAuditEvent`（只記 packId/version/digest/固定原因字串，型別上不含任意內容欄位）、`featurePackCapability`（把已安裝且啟用的 pack 編譯成 `AgentCapability`，`requiresEntitlement` 直接沿用 issue 07 `assembleCapabilities` 既有的過濾——本檔案完全沒有新增 gating 邏輯，smoke 以 source-drift guard 確認 `capabilities/runtime.ts` 對 feature pack 一無所知）。
- `app/src/store/featurePackStore.ts` — zustand store，`install` 接受注入的 `verify(manifest, bytes)` async function（維持與 Electron node:crypto 解耦，一如 `subscriptionStore.refresh` 的 injectable fetcher），本機持久化 packs + audit（capped 300）。
- `app/src/pages/SettingsPage.tsx`「功能包」群組：依 status（active/disabled/entitlement-denied/incompatible）顯示對應說明與啟用/停用/回復/移除按鈕。
- 驗證：`app/scripts/smoke-feature-pack.mts`（8 groups，含真實 RSA sign/verify，mirrors `smoke-update-migration.mts` 手法：manifest 欄位驗證、簽章＋雜湊驗證含竄改偵測、entitlement 拒絕不影響 Free Core、install/update/disable/enable/uninstall/rollback 全生命週期、驗證失敗與版本不相容都不會讓 app 卡死或動到本機資料、audit 只含 version+digest、runtime seam 重用既有 `requiresEntitlement` 閘門）；wired into `npm run smoke`、`smoke:ci`，新增 `npm run smoke:feature-pack`。`tsc -b` 與 `npm run smoke` 全綠。
