# 03 — Verified channel promotion

**What to build:** 建立唯一 protected publish owner，只在 verified `release-ready` receipt 成立後，將同一組 qualified artifacts 發布到明確的 Beta 或 Stable channel。

**Blocked by:** 01 — Packaged change evidence schema；02 — Package jobs 改為 candidate-only。

**Status:** resolved

- [x] Publish job 只依賴 verified promotion receipt，並是唯一取得 update publish credential 的 job。
- [x] Channel 是 closed enum，實際參與 public download URL、upload destination 與 promotion evidence。
- [x] Commit、workflow run/attempt、version、manifest 與 installer hashes 全部一致才可發布；mixed attempt fail closed。
- [x] Local fake endpoint 證明 installers 先於 manifest、Beta/Stable 隔離、同 identity retry idempotent、conflicting hash 拒絕。
- [x] 發布成功產生不含 secret 的 promotion receipt；任何中途失敗不留下可被 client 接受的部分 promotion。

## Comments

- 2026-08-31：新增唯一 protected `publish` owner；credential 僅存在 `release-publishing`，並以 `release-ready` 成功結果及 verified receipt 雙條件 admission。所有非 publish job 以完整 source digest allowlist fail closed，AWS 與 opaque Python second-writer 突變均被阻擋。
- 2026-08-31：channel 限定 `beta`／`stable`，綁定 repository-level public base URL、獨立 publish destination 與 promotion identity；signed manifest 的 artifact URL 必須精確符合 channel/platform/arch/encoded filename。
- 2026-08-31：receipt 綁定 full commit SHA、run/attempt、semver、qualification hash、三平台 manifest/installer hashes；使用 app 內建 public key 驗證 manifest 與 artifact RSA-SHA256 簽章，mixed attempt、型別偽造、改簽後竄改皆 fail closed。
- 2026-08-31：真實本機 HTTP endpoint smoke 證明 installers 先 staging、manifests 後 staging、最後 atomic POST；Beta/Stable 隔離、retry idempotent、conflict/partial failure 拒絕，且 commit acknowledgment identity/channel/version 不一致時不產生 published receipt。
- 2026-08-31 驗證：`npm run smoke:release`（12/12）、`npm run smoke:update`、`npm run build`、focused oxlint、workflow YAML parse、`check-pi-contract.mts`、`smoke-tracker-index-links.mts`、`git diff --check` 全綠。完整 `npm run smoke` 已依流程執行一次，於本票測試通過後被同時存在、非本票範圍的 Pi package capability WIP 阻擋（`smoke-pi-host-protocol.mts` fixture 尚未包含 `packages`）；未修改該批使用者變更。
- 2026-08-31 code review：Standards／Spec 雙軸複核後修正公鑰簽章驗證、strict evidence types、channel public URL 綁定、atomic acknowledgment、release-ready success admission、repository variable scope 與唯一 writer fail-closed allowlist。
