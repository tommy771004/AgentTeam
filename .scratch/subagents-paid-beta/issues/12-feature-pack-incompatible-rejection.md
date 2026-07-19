# 12 — Feature pack 不相容拒絕修補

**What to build:** `featurePackCapability`(`featurePacks.ts:174-186`)對 `status:'incompatible'` 的 pack 仍會編譯成 `AgentCapability`,只靠 `requiresEntitlement` 過濾。修成「不相容就不存在」,符合 #09「一個 failed or incompatible pack cannot strand the application」原意。

**Blocked by:** None — 可立刻開始。

**Status:** 已完成

- [x] `featurePackCapability` 只接受 `status:'active'` 或等同可啟用狀態;`incompatible` / `entitlement-denied` / `disabled` / `uninstalled` 都編譯成 `null`。
- [x] `installFeaturePack` 與 `featurePackStore.install` 返回或儲存 `incompatible` 狀態時,該 pack 永遠不會進入 `assembleCapabilities` 的 all 集合。
- [x] 「不相容的 pack 不會 freeze app」、「本機資料仍可讀」:source-drift guard 強化 `featurePackCapability` 對所有不相容路徑都拒絕。
- [x] 驗證用 `smoke-feature-pack.mts` 既有的 8 groups + 新增第 9 組「`featurePackCapability` 對不相容狀態回 `null`」。
- [x] `tsc -b`、`npm run smoke` 全綠。

**Implementation notes (2026-07-19):**
- `app/src/agent/featurePacks.ts:171-194` — `featurePackCapability` 早期返回:當 `record.status` 屬於 `{ 'uninstalled','incompatible','entitlement-denied','disabled' }` 時回傳 `null`,不再編譯成 capability。`active` 狀態仍正常產出 `requiresEntitlement` 給 runtime 過濾。
- `app/scripts/smoke-feature-pack.mts` Group 9 新增四個斷言:分別構造 `incompatible`、`entitlement-denied`、`disabled`、`uninstalled` 狀態的 record,驗證 `featurePackCapability` 都回 `null`。
- 不動 `installFeaturePack` 的回傳形狀(spec 中專案聲明 `{ok: true}`、`{ok: false}`);只動 `featurePackCapability` 的可接受 status set。
- 驗證:`tsc -b`、`npm run smoke`、`npm run smoke:feature-pack` 都全綠。

**Notes for #10:**
- #10 已完成;三個 runtime site 現在都餵 entitlement,付費 capability 才會進 catalog。