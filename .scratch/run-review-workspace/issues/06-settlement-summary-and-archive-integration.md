# 06 — Settlement、summary 與 Archive 整合

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

把 snapshot finalization 接到 `runFinalizationSequence` 的唯一 lifecycle seam，在 summary／Archive 前取得 bounded `reviewSnapshotRef`。summary card 保留 legacy diff replay 相容，但新 run 不再以 `workspaceDiff(...).slice(0, 200_000)` 作歷史 authority；failure/partial 必須可見且不改寫 run status。

## Acceptance criteria

- [x] success/failed/halted/cancelled/recovered run 都恰好一次 finalize snapshot
- [x] summary、Archive、renderer reload 指向相同 snapshot identity
- [x] snapshot 建立失敗不阻斷 release/drain，UI 同時不把它顯示成 clean workspace
- [x] commit 或新 run 後重開舊 summary，snapshot hash/manifest/patch 不變
- [x] settlement idempotency 與 active-run reattachment 競態 smoke 通過

## Blocked by

03 — Host-owned ReviewArtifactStore; 04 — Snapshot capture 與歸屬 fidelity

## Comments

- 2026-08-30：新增 negotiated `review/v1/finalize` Host method，從持久 pending artifact 取得 immutable admission、capture settlement、transactionally finalize，並回 bounded `ReviewSnapshotRef`。coordinator 在唯一 finalization sequence、summary/Archive projection 前呼叫；early failure 也走同一 helper。recovery 可只用 runId 找回已持久 snapshot identity；ready/partial/failed retry 直接回同一 ref。
- 新 run 有 canonical snapshot ref 時不再執行 legacy `workspaceDiff(...).slice(0, 200_000)`；該字串只保留無 Host snapshot 的舊 archive/plain-browser fallback。capture 失敗產生 visible failed ref，但不改寫 task result，也不阻塞 afterRun、release 或 queue drain。
- Gate evidence：`smoke-review-settlement-integration.mts` 以真 Host protocol 驗證 admit→modify→finalize、後續 commit 後 byte-stable replay、snapshotId/runId recovery retry idempotency、capture crash failure不變成 protocol failure，以及 summary ordering/drift guards。既有 finalize-idempotency 9/9、reattach reconcile、run-journal durability、Pi Host build、aggregate review smokes、TypeScript、oxlint 與 diff check 全綠。
