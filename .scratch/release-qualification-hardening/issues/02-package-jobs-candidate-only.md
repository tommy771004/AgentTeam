# 02 — Package jobs 改為 candidate-only

**What to build:** 讓每個平台 package job 只建立、驗證並保存私有 candidate artifacts；在 Paid Beta qualification 前，任何失敗路徑都不能寫入 customer-facing update channel。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Package matrix 不再持有或使用 customer-facing update publish credential。
- [x] Signed manifest 與 installers 只上傳至 CI artifact storage，仍可供後續 gate 下載。
- [x] Workflow contract test 證明 package success 加 qualification failure 造成零 remote publish requests。
- [x] Build、package、signing、notarization 與 lifecycle evidence 的既有 fail-closed 行為保持不變。

## Comments

- 2026-08-31：移除 package matrix 的 customer-channel PUT step；signed candidate manifest、installers 與 verification logs 僅保存為 GitHub Actions artifacts，後續 gate 仍以既有 artifact identity 下載驗證。
- 2026-08-31：`release-signing` 僅保留 package/signing 所需值；發布 token／URL 遷移至目前未被 workflow 引用的 `release-publishing`，文件包含舊 credential 的 UI／CLI 移除與驗證步驟。
- 2026-08-31：workflow contract 以 dependency fixed-point 推演 package success／qualification failure，嚴格解析 job condition，並以完整 pre-qualification job-source SHA-256 allowlist fail closed。AWS、Node、Python、third-party action、反向 job 宣告、wrapped `always()`、未知／混合條件及 failed-job output 突變均被阻擋。
- 2026-08-31 驗證：`npm run build`、完整 `npm run smoke`、`npm run smoke:update`、`npm run smoke:install`、`smoke-release-evidence.mjs`、focused oxlint、`check-pi-contract.mts`、`smoke-tracker-index-links.mts`、`git diff --check` 全綠；review 修正後再次執行 focused checks。
- 2026-08-31 code review：Standards／Spec 雙軸複核後修正 environment ownership、dependency ordering、command/action allowlist 與 condition/output fail-closed 語意；最終複查 CLEAN。
