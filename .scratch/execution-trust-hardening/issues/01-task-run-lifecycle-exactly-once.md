# 01 — Task run lifecycle 原子接納與幂等終態

**What to build:** 使用者在 opt-in 並行或重試下，無論是否同時送出相同 `runId`、或 finalization 被觸發兩次，都只會看到一個 Loop run 與一組終態副作用（Archive、`onSettled`、容量釋放、queue drain）。Task run coordinator 是 admission 與 terminal-state guard 的唯一擁有者；重複接納回傳明確非成功的 duplicate 結果，且不啟動第二個 Loop run。

**Blocked by:** None — can start immediately.

**Status:** resolved
- [x] 並行／重入下，同一 `runId` 在第一筆 admission 尚未完成前再提交，仍不得第二度 dispatch Loop run。
- [x] 已 finalized 的 `runId` 再提交得到 deterministic 非成功 duplicate 結果，且不重寫對話／Archive。
- [x] 同一 `runId` 的 finalization 副作用（Archive、`onSettled`、capacity release、queue drain）最多發生一次。
- [x] 互動（composer／retry）與自動化（schedule 等）來源皆有 scenario／契約測試覆蓋。
- [x] 不同 `runId` 的 capped 並行仍可用；不退回全域單跑鎖，也不改變 ADR-0003 預設。
- [x] 終態／active 登錄的保留策略 fail-closed：不得因 eviction 讓舊 `runId` 被當成全新成功路徑重新 admit。

## Comments

### 2026-07-16 — TDD slice

- Seam: `tryAdmitTaskRun` / `claimFinalizeTaskRun` / `releaseTaskRunAdmission` + tombstones.
- Production: atomic admit before awaits; release on queue/busy/suggestion; finalize claims before Archive/onSettled/drain.
- Tests: prod-modules atomic+idempotent+eviction; scenario concurrent same runId under opt-in concurrency.
