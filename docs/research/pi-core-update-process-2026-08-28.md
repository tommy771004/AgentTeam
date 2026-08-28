# Pi Core 更新流程研究（2026-08-28）

## 結論

本專案的 Pi Core **不是 npm package dependency，也不是 Git submodule**。`vendor/pi/` 是直接提交進主 repo 的上游 source snapshot；ADR 將策略稱為「Git subtree」，但目前 Git metadata 沒有 `.gitmodules`、submodule gitlink、Pi remote 或 `git-subtree-*` commit trailer。實際同步機制是專案自製的 `app/scripts/sync-pi.mts`：從一個乾淨的官方 Pi checkout 以 `git archive` 取出舊、新兩個 commit，確認目前 vendor 等於舊 commit，再以新 commit 的完整 snapshot 覆蓋 `vendor/pi/`。

本次已完成同步到官方 **v0.84.3**，tag commit `4e58f324fae8ebfa98a3d45181fb248072a2afac`。同步前進一步比對發現：舊 pin 雖寫 v0.81.1 tag commit `20be4b18…`，實際 vendored source 已是其後的 `dd6bea41efa8caa7a10fe5a6401676dc5699f83f`（六份 changelog 多了下一輪 `[Unreleased]` 標題）；先把 baseline pin 校正為真實 source commit，才執行 `dd6bea4… → 4e58f32…`，避免把既有 source 誤當成本次 patch。

最終 qualification 是 **GO**。Pi upstream isolated suite、vendor offline build、本專案 typecheck/production build、完整 `smoke:pi-host`、migration、Electron reattach E2E、recovery、security 與 packaging contracts 均通過；證據在 [`release-evidence/pi-sync-release-record.json`](../../release-evidence/pi-sync-release-record.json) 與 [`release-evidence/pi-host-qualification.json`](../../release-evidence/pi-host-qualification.json)。

## 本專案如何 pin 與載入 Pi

- [`vendor/pi/PI_UPSTREAM_PIN.json`](../../vendor/pi/PI_UPSTREAM_PIN.json) 記錄官方 repo、完整 commit、tag、package version、release source archive SHA-256，以及排除 build artifacts 後的 source-tree SHA-256。目前是 v0.84.3 / `4e58f32…` / `0.84.3`。
- [`app/scripts/piVendorTree.mts`](../../app/scripts/piVendorTree.mts) 的 hash 排除 pin、patch ledger、`node_modules`、所有 `dist` 和 generated provider data；禁止 symlink。這讓 pin 驗證的是可重建 source，不是機器相依的安裝或 build 產物。
- [`app/scripts/smoke-pi-sync-gate.mts`](../../app/scripts/smoke-pi-sync-gate.mts) 驗證 repo URL、commit 格式、固定 tag/version、tree hash、ledger marker 與 upstream root manifest。
- [`app/electron/piVendor.ts`](../../app/electron/piVendor.ts) 在執行時直接 dynamic-import `vendor/pi/packages/coding-agent/dist/index.js`；[`app/electron/piCoreRuntime.ts`](../../app/electron/piCoreRuntime.ts) 使用 Pi 的 `ModelRuntime`、`SessionManager`、`DefaultResourceLoader`、`createAgentSession`、七個 tool factories、`config.js`，以及非 package-export 路徑 `dist/core/auth-storage.js`。所以 source 能 build 還不夠，這些 runtime contracts 也必須逐一過 gate。
- [`app/package.json`](../../app/package.json) 把 `../vendor/pi` 與其 runtime `node_modules` 放進 Electron `extraResources`；release 不是從 npm registry 動態抓 Pi。

依本地 Git tree，`vendor/pi/*` 都是一般 `100644`/`100755` entries，而非 submodule 的 `160000` gitlink；repo 只設定 AgentTeam 的 `origin`。所以更新時應使用下述 custom sync command，**不要使用 `git submodule update` 或 `git subtree pull`**。

## 現有同步程式實際做什麼

[`app/scripts/sync-pi.mts`](../../app/scripts/sync-pi.mts) 的契約是：

1. 只接受完整的 `--from-commit`、`--to-commit`、`--source-dir`；明確拒絕 `--branch`、`--ref`、`--latest`、`--main`、`--remote`。
2. `fromCommit` 必須等於現有 pin，`source-dir` 的 `HEAD` 必須正好等於 `toCommit`，而且 checkout 必須乾淨。
3. 以 `git archive` 建立兩個乾淨 snapshot，先證明目前 `vendor/pi` 與 `fromCommit` 完全一致（依 `piVendorTree` 的排除規則）。這也表示現況其實不容許 `vendor/pi` 留有 source patch；產品差異應在 app adapters/Extension Packs，ledger 則記錄受影響 contract。
4. 在官方 checkout 執行上游 `bash test.sh`；成功後才刪除舊檔、複製 `toCommit` snapshot、重算 tree hash、更新 pin。這會使用上游隔離過的 non-e2e suite，避免直接跑含 credentials/network assumptions 的泛用 npm test。
5. 可輸出 synchronization manifest；全程不切換或建立本專案 branch，branch/PR 由操作者負責。

本地已實際通過三個現況檢查：`smoke-pi-sync-gate.mts`、`smoke-pi-core-vendor.mts`、`smoke-pi-sync-workflow.mts`。

## 本次升到 v0.84.3 已修正的相容性問題

### 1. `packageVersion` 會被誤寫成 `0.0.3`

舊 `sync-pi.mts` 從 upstream **root** `package.json` 讀 `version`。官方 v0.84.3 root manifest 的 version 仍是 `0.0.3`，但 `packages/coding-agent/package.json` 才是 `0.84.3`。現已改讀 coding-agent manifest，build cache 也使用同一 release version，並有 regression smoke。

官方證據：[v0.84.3 root package.json](https://raw.githubusercontent.com/earendil-works/pi/v0.84.3/package.json) 的 root version 是 `0.0.3`；[coding-agent package.json](https://raw.githubusercontent.com/earendil-works/pi/v0.84.3/packages/coding-agent/package.json) 是 `0.84.3`。

### 2. v0.84.x workspace layout 已改，現有 build adapter 會壞

舊 [`app/scripts/build-pi-vendor.mts`](../../app/scripts/build-pi-vendor.mts) 固定 build/copy：`tui`、`ai`、`agent`、`storage/sqlite-node`、`coding-agent`、`server`；[`app/scripts/piBuildWorkspaceLinks.mts`](../../app/scripts/piBuildWorkspaceLinks.mts) 也固定 relink 這六個 workspace。

官方 v0.84.3 已把 `packages/storage/*` 改為 `packages/session-backends/*`，root build chain 並新增 `telemetry`、`protocol`、`client`，SQLite 路徑變成 `packages/session-backends/sqlite-node`。`pi-coding-agent` 也新增 `pi-client` 與 `pi-protocol` dependencies，CLI/RPC build layout 改為 bundle paths。若直接同步，現有 build adapter 會嘗試 copy 不存在的 `packages/storage/sqlite-node/dist`，workspace relink 也缺新 packages。

本次已同步調整：

- `build-pi-vendor.mts` 的 build/copy package 清單、required artifacts 與 runtime dependency checks；
- `piBuildWorkspaceLinks.mts` 的 workspace mapping（至少新 `session-backends/sqlite-node`、`telemetry`、`protocol`、`client`，依官方 lockfile/runtime 實際需求確認）；
- `smoke-pi-build-workspace-links.mts`、`smoke-pi-core-vendor.mts`、`smoke-pi-core-runtime.mts`、`smoke-pi-sync-gate.mts` 的 layout/version expectations；
- packaging smoke 與 `extraResources` 驗證，確保新的 runtime dependency tree 仍完整打包。

官方證據：[v0.84.3 root package.json](https://raw.githubusercontent.com/earendil-works/pi/v0.84.3/package.json) 列出新的 workspaces/build chain；[v0.84.3 coding-agent manifest](https://raw.githubusercontent.com/earendil-works/pi/v0.84.3/packages/coding-agent/package.json) 列出新增 dependencies 與 bundle entrypoints。

### 3. Live model catalog 不能作為可重現 build input

乾淨 checkout 首次 build 會即時抓 models.dev；2026-08-28 的 catalog 已含 v0.84.3 型別不接受的 API 值，造成同一 commit 隨日期漂移而失敗。官方 `pi-0.84.3-source.tar.gz` 內附 release 時的 model snapshot，離線 build 可通過。本專案現把 artifact 名稱與 SHA-256 `056f84c4…b6500` 寫入 pin；build 缺資料或本機 cache 過期時，只下載、驗證這個固定 archive，再執行 `build:offline`，不再 fallback 到 live catalog。

## 建議的實際更新 runbook

在 dedicated sync branch/PR 進行，目標永遠用經 review 的完整 SHA，不追 moving `main`：

1. 閱讀 [v0.84.3 官方 release notes](https://github.com/earendil-works/pi/releases/tag/v0.84.3) 與 `v0.81.1...v0.84.3` source diff。v0.83.0 有 TypeBox deprecated API removal；v0.84.3 另有 Google thinking type rename，以及 session、compaction、tool、auth、bundle/build 相關變更。先對照上述本產品直接使用的 Pi surface。
2. 先修 `sync-pi.mts` 的 package-version source 與 regression smoke；規劃/更新 v0.84.3 build workspace adapter。adapter 可暫時兼容舊、新 layout，讓變更可在 sync 前驗證。
3. 準備官方乾淨 checkout，detach 到 `4e58f324fae8ebfa98a3d45181fb248072a2afac`，確認 `git status --porcelain` 為空。
4. 從 `app/` 執行：

   ```bash
   npm run sync:pi -- \
     --from-commit dd6bea41efa8caa7a10fe5a6401676dc5699f83f \
     --to-commit 4e58f324fae8ebfa98a3d45181fb248072a2afac \
     --release-source-asset pi-0.84.3-source.tar.gz \
     --release-source-sha256 056f84c467450fb5700ad4df9c8cc669bf7f6046976eed7a19eadbc7553b6500 \
     --source-dir /absolute/path/to/clean/pi-checkout \
     --output ../release-evidence/pi-sync-manifest.json
   ```

   此步會先跑上游 `bash test.sh`，再更新 vendor 與 pin；執行前仍應先留存 working-tree diff，因成功進入 copy 階段後會直接改寫 `vendor/pi`。上游 `find` tests 需要 `fd` 在 PATH 中。
5. Review source diff，逐項更新 [`vendor/pi/PI_CORE_PATCH_LEDGER.md`](../../vendor/pi/PI_CORE_PATCH_LEDGER.md)：移除上游已涵蓋的 contract，保留仍存在者並寫明 rationale/test。注意：同步腳本只檢查 ledger marker，卻在 manifest 無條件填 `ledgerReconciled: true`；這個欄位不是 review 證據。
6. 依新 workspace 完成 build adapter 後執行 `npm run build:pi-vendor`、`npm run build`。
7. 至少執行 ADR-0044 指定的完整 qualification：Pi upstream tests、Host Protocol、Equivalent Tool parity、settings/session migration、Electron/restart/recovery、安全、packaging。對應現有入口包括 `npm run smoke:pi-migration`、`npm run smoke:pi-host`、`npm run qualify:pi-runtime-contract`、`npm run smoke:pi-parity-qualification`、`npm run smoke:recovery`、`npm run smoke:security`、`npm run smoke:pi-electron-host-e2e`、完整 `npm run smoke`，以及 release platform 的 `npm run dist:mac` / Windows qualification。
8. 所有 gate 真正通過後，才可執行 `npm run qualify:pi-sync -- --from-commit <OLD_SHA> --to-commit <NEW_SHA> --all-gates` 產生 release record；`to-commit` 不給時預設為目前 pin。`--all-gates` 仍只是把九個 booleans 設為 `true`，**不會代替執行測試**；應由 CI artifacts/PR checks 證明後再使用。最後確認 pin hash gate、reproducible host artifact SHA-256 與 packaged app cold-start/restart 均通過，再合併 dedicated PR。

## 主要風險與流程缺口

- **版本 metadata bug（已修）：** sync/build cache 改讀 coding-agent release version。
- **layout break（已修）：** build/relink adapter 已涵蓋 v0.84.3 session backend 與新增 workspace。
- **model catalog 漂移（已修）：** build pin 官方 release source archive checksum 並只使用 release snapshot。
- **ledger evidence 過度宣稱：** sync 只檢查固定文字便宣告 `ledgerReconciled: true`。
- **qualification evidence 過度宣稱：** `qualify-pi-sync --all-gates` 不執行 gate，只信任 CLI flag。
- **脆弱 deep import：** 本產品直接 import `dist/core/auth-storage.js`，不在 coding-agent package exports 內；每次升級都必須特別驗證。
- **hard-coded version smokes：** 多個 smoke 固定 v0.81.1；應在升級時更新，較佳做法是改成相互一致性檢查，避免每次 release 都散落改常數。
- **策略與 Git metadata 不一致：** ADR 說 Git subtree，實作是 ordinary-tree snapshot + custom copier。文件與操作手冊應明確稱為「pinned vendored snapshot」，或真正採用有 subtree ancestry/trailers 的流程，避免維護者誤用 `git subtree pull`。

## 一手來源

- 本專案 ADR：[`0023`](../adr/0023-vendor-pi-core-behind-electron-shell.md)、[`0043`](../adr/0043-keep-the-vendored-pi-delta-minimal-and-auditable.md)、[`0044`](../adr/0044-pin-pi-releases-and-sync-upstream-through-gated-prs.md)
- 本專案 pin / ledger：[`PI_UPSTREAM_PIN.json`](../../vendor/pi/PI_UPSTREAM_PIN.json)、[`PI_CORE_PATCH_LEDGER.md`](../../vendor/pi/PI_CORE_PATCH_LEDGER.md)
- 本專案同步/build/gates：[`sync-pi.mts`](../../app/scripts/sync-pi.mts)、[`piVendorTree.mts`](../../app/scripts/piVendorTree.mts)、[`build-pi-vendor.mts`](../../app/scripts/build-pi-vendor.mts)、[`qualify-pi-sync.mts`](../../app/scripts/qualify-pi-sync.mts)、[`piSyncEvidence.ts`](../../app/src/agent/piSyncEvidence.ts)
- Pi 官方：[v0.84.3 release](https://github.com/earendil-works/pi/releases/tag/v0.84.3)、[tag commit `4e58f32`](https://github.com/earendil-works/pi/commit/4e58f324fae8ebfa98a3d45181fb248072a2afac)、[v0.84.3 root manifest](https://raw.githubusercontent.com/earendil-works/pi/v0.84.3/package.json)、[v0.84.3 coding-agent manifest](https://raw.githubusercontent.com/earendil-works/pi/v0.84.3/packages/coding-agent/package.json)
