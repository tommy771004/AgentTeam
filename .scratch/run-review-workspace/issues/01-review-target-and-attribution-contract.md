# 01 — Review target 與 attribution contract

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

定義 discriminated `ReviewTarget`、snapshot lifecycle、attribution fidelity、manifest/page envelope 與 error vocabulary，並提供純投影判斷 target 是否 immutable、refreshable、mutation-capable。舊 `ThreadRunSummary.diff` 明確標為 compatibility projection，不能進入新 interface 的 canonical path。

## Acceptance criteria

- [x] `run-snapshot`、live working tree、staged、branch range、snapshot range 在型別層互斥
- [x] `exact | attributed | shared | partial` 只能由 Host evidence 建立或降級，無 renderer/model 升級路徑
- [x] `pending | capturing | ready | partial | failed | missing | deleted` transition table 完整且非法轉移 fail closed
- [x] 純 fixture smoke 覆蓋 mutability、refreshability、缺失 snapshot 不 fallback 與 attribution downgrade
- [x] 舊 archive 缺 snapshot ref 時只顯示 legacy/ephemeral 語意

## Blocked by

—

## Comments

- 2026-08-30：新增 `app/src/agent/reviewContract.ts`，以 discriminated `ReviewTarget`、完整 lifecycle transition table、Host evidence normalizer、downgrade-only fidelity、manifest/page envelope、bounded error vocabulary 與 `projectRunReviewSource` 建立純 contract seam。`ThreadRunSummary.reviewSnapshotRef` 接上 bounded identity，既有 `diff` 註記為 legacy/ephemeral compatibility data。
- Gate evidence：`smoke-review-contract.mts` 已掛入 `npm run smoke` 主鏈；focused smoke 通過、`npx tsc -p tsconfig.app.json` 無錯、`npx oxlint src/agent/reviewContract.ts` 0 warning。
