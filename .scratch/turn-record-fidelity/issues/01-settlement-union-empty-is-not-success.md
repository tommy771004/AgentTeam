# 01 — Settlement 收斂成閉合聯集，空回覆不再是成功

**What to build:** 一個成功呼叫了模型、但沒有產出任何 assistant 文字的回合，使用者看到的是「這次沒有產出，可以重試」，而不是一顆寫著「Pi Core 完成（無文字輸出）」的助理泡泡、綠色勾勾、0.9 信心值、進歸檔並餵給學習迴圈。回合結算變成一個閉合聯集 —— `answered` / `empty` / `interrupted`（帶 `user` 或 `timeout` 原因）/ `failed` / `cancelled` —— 五種在使用者面前都是不同的話，任何消費端都以 exhaustive switch 處理，漏掉一種就編譯不過。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [x] 回合結算是一個 discriminated union，五個變體各自可被消費端區分；閉合聯集的 switch 以 `assertNever` 收尾
- [x] 空回覆（provider 正常結束但無內容）結算為 `empty`，**不**寫入成功泡泡、**不**以成功歸檔、**不**觸發學習迴圈、**不**給 0.9 信心值
- [x] `interrupted` 的兩個原因（使用者停止／逾時）在結算上可區分，逾時仍保留已產出的內容
- [x] `failed` 與 `cancelled` 不再與上述任何一種混同
- [x] Seam 1 smoke：以 loopback 模型腳本化「終止於 stop 但無 content block」的回合，斷言結算為 `empty` 且該 run 未以成功歸檔
- [x] Seam 1 smoke：五種結算各有一條斷言，證明彼此不會塌陷成同一種
- [x] `npm run build`、`npm run smoke`、`npm run smoke:pi-host` 全綠

## Comments

**Implemented and verified** (uncommitted at time of writing — see the commit note below).

Landed beyond the literal ticket, because the union forced the decision:

- **A rejected provider request used to be reported as a success.** Pi does not throw on an HTTP 4xx; it records an assistant message with empty content and `stopReason: 'error'`, so the turn reached the old success branch with no text. `piTurnProviderError()` now detects that and settles `failed`, carrying the provider's own error text to the user. Found while writing the `failed` case of the seam-1 smoke.
- **An empty round no longer ends a Goal loop.** Once `empty` exists, `runPiOrchestration` has to decide what it means. An empty round is exactly what another iteration exists to fix, so the loop continues on it (`isCompletedModelCall`), the DoD stays unmet, and a goal still empty at the iteration cap settles `failed`. Without this, the existing orchestration scenario (iteration 1 silent, iteration 2 answers) would have broken.
- **An empty turn still records the user's prompt.** It was model-visible, so it is logged; only the assistant message is omitted, because the assistant said nothing.

Review findings accepted and fixed before completion:

- The first cut let the renderer's feed cache (`runActivityStore.draftText`) promote an `empty` settlement into a success. That is the direction ADR-0039 forbids and it reopened the exact hole this ticket closes. Removed: the answer now comes from the Host's items only, which already rebuild from streamed deltas.
- The reading carried `archiveAsSuccess` / `feedsLearningLoop` / `retryable` / `textSource` that no consumer read — declared guarantees rather than enforced ones. Deleted; `status` is the guarantee, and the smoke asserts it.
- `answered || empty` was compared inline at two call sites, so a sixth settlement would still compile. Extracted `isCompletedModelCall()`, which switches exhaustively.
- Renamed the reading off the word *projection* (`PiTurnOutcome` / `piTurnOutcome`): CONTEXT.md reserves **UI Projection** for the renderer's disposable view of Host state.

**Deferred to ticket 03 (protocol versioning):** `runs/settle` now refuses the retired `'success'` value and `turn/submit` returns the new vocabulary, while `PI_HOST_PROTOCOL_VERSION` stays `1`. No real peer skew exists today — Host and renderer ship in one bundle and negotiate at `initialize`, and nothing persisted carries a settlement (`PiQueuedRun` stores `status`, not `settlement`) — but ADR-0038 makes this a versioned protocol, so the bump belongs with the ticket that versions the Turn Record. 40 files send `protocolVersion: 1` and `piHostReleaseEvidence` asserts it, so the bump is a release-qualification change, not a settlement change.

**Two failures in the tree that are NOT from this ticket** (both pre-date it at `HEAD`):
1. `smoke:pi-migration` → `smoke-pi-electron-cutover.mts` requires `RunProcessFeed.tsx` to contain `正在撰寫回覆`; that string is at `HEAD` in neither the component nor the worktree copy — it now lives in `runLifecycle.ts`. The drift guard needs repointing at its new owner (never weakening) by whoever moved it.
2. The Goal-based iteration ceiling disagrees with itself: `runPiOrchestration` still clamps to 8 while the Host advertises up to 32 via `clampPiIterations`, so a 16-iteration request reports 16 and enforces 8. From the in-flight `loopBounds.ts` work, not from this ticket.
