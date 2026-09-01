# 11 — Shipped-runtime CI coverage

**What to build:** 讓所有會進入 installer 的 runtime 與其 authority contracts 都能觸發 blocking CI，並在 PR 階段取得最小但誠實的 macOS-specific evidence。

**Blocked by:** 09 — No-App-launch deterministic qualification。

**Status:** 已完成

- [x] 只修改 vendored Pi sources 或 pin metadata 的 PR 會觸發 deterministic qualification、Pi build 與 owning compatibility checks。
- [x] Release/security/architecture authority contract 的變更會觸發相應 blocking checks，不依賴修改 product source 才啟動。
- [x] macOS blocking job 執行最小 platform runtime contracts，且不需要或冒充 production signing/notarization。
- [x] Linux、Windows、macOS jobs 的責任與 platform-only evidence 清楚分離，無重複執行 customer-facing publish。
- [x] Workflow trigger fixtures 證明 shipped runtime、pin、contract 與普通 app changes 都得到預期 coverage。

## 完成證據

- `ci.yml` 的 push／pull request path filters 現在涵蓋 `vendor/pi/**`、pin／patch ledger、release workflow、security baseline、release signing setup、ADR 與 canonical authority docs。
- Ubuntu `pi-runtime` job 安裝 bubblewrap 並擁有完整 `qualify:pi-runtime-contract` 與 Linux kernel proof；既有 Ubuntu／Windows matrix 只保留 common build、deterministic qualification、stable smoke 與 built Electron contract，避免重複 sandbox evidence。
- `macos-runtime` job 只執行 unsigned native platform runtime contracts：Pi Host build、platform contract、Seatbelt、ADR-0047 real-turn denial 與 outbound shell evidence；不注入 signing/notarization credentials，也不 packaging/publish。
- `smoke-ci-shipped-runtime-coverage.mts` 以 workflow trigger fixtures 驗證 ordinary app、vendored runtime、pin metadata、release/security/architecture contracts 的 blocking coverage；它也拒絕 optional/skipped qualification、重複 Linux kernel proof，並以精確 package-script allowlist 防止 macOS job 間接混入 release/publish 行為。
- 本機驗證通過：`npm run smoke:ci-shipped-runtime-coverage`、`npm run qualify:macos-runtime-contract`、`COMPLEXITY_BASE_REF=origin/main npm run qualify:deterministic`、`npm run build`、`COMPLEXITY_BASE_REF=origin/main npm run smoke`。
