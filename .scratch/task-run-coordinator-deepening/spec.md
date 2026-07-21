# Task run coordinator 接縫深化

Status: resolved

## Problem Statement

使用者需要每一個 Chat turn 或 automation trigger 都有一條可追蹤、只完成一次的 Task run 生命週期。現在產品文件把 `taskRunCoordinator.runTask` 定義為唯一入口，但實際上它仍只是把請求轉交給 `runExternalObjective`；capacity、附件處理、thread bind、beforeRun、dispatch 與 finalization 的真正編排仍集中在 legacy module。這使 coordinator 不是承擔複雜度的深 module，後續維護者仍可能繞過它、在 legacy 路徑加入第二份 lifecycle 規則，或讓 adapter 再次執行 Archive、release、queue drain 等副作用。

這個落差尤其危險於 opt-in concurrent Loop run、queue drain、hook deny、runner exception、CLI 與 background delegate 等終止路徑。使用者可能看到重複的 completion、錯誤的 busy 狀態、未釋放的 capacity，或在某一個 run 結束時意外影響另一個 run。

## Solution

讓 `taskRunCoordinator.runTask` 成為真正的 Task run lifecycle owner。所有 product entry 都透過這個 public interface 進入；coordinator 建立 immutable run identity 與 dispatch snapshot，依固定順序處理 admission、thread binding、runner adapter、唯一 finalization 與 queue drain。Built-in loop 與 external CLI 只負責執行及回傳 outcome，不再各自保存 lifecycle 收尾責任。

`runExternalObjective` 保留為相容 adapter，僅轉交到 coordinator，不再持有第二套 orchestration。既有呼叫者的輸入與結果契約維持相容；新增測試以 `runTask` 作為唯一外部行為 seam，驗證每個 terminal path 的 observable lifecycle，而不是測試 legacy implementation 的內部函式。

## User Stories

1. As a 使用者, I want every Chat turn to enter through one Task run coordinator, so that the task lifecycle is consistent regardless of the entry surface.
2. As a 使用者, I want every automation trigger to enter through the same coordinator, so that scheduled, webhook, Telegram, event, and delegate runs follow the same safety and cleanup rules.
3. As a 使用者, I want each accepted Task run to have one stable `runId`, so that progress, activity, HITL, cancel, summary, Archive, and metrics refer to the same work.
4. As a 使用者, I want the coordinator to reserve capacity before dispatch, so that a run cannot start without an available slot.
5. As a 使用者, I want a run that exceeds the cap to keep the existing queue or steer semantics, so that concurrency hardening does not turn normal pressure into silent loss.
6. As a 使用者, I want a queued run to retain its original request and trigger evidence, so that a later queue drain does not execute a different task.
7. As a 使用者, I want attachments to be normalized and materialized once, so that a queued or retried run does not create duplicate files or lose its input.
8. As a 使用者, I want an admitted run to hydrate its attachments exactly once for its selected runner, so that built-in vision and CLI execution receive the same intended inputs.
9. As a 使用者, I want a run to bind to exactly one thread before execution, so that its user bubble and activity cannot appear in another conversation.
10. As a 使用者, I want hidden background worker threads to remain hidden and non-selected, so that delegated work does not steal my active conversation.
11. As a 使用者, I want beforeRun hooks to run once before dispatch, so that policy, context, audit, and notification effects are not duplicated.
12. As a 使用者, I want a hook-denied run to receive a terminal failed result and normal cleanup, so that denied work cannot leave a running thread or reserved slot behind.
13. As a 使用者, I want the runner to receive an immutable snapshot, so that changing the selected project, thread, settings, or attachments during execution cannot redirect an in-flight run.
14. As a 使用者, I want built-in loop execution and external CLI execution to share the same coordinator contract, so that their different capabilities do not create different lifecycle semantics.
15. As a 使用者, I want an adapter to return an outcome without archiving or releasing capacity itself, so that the coordinator can enforce one finalization order.
16. As a 使用者, I want a successful run to publish its thread summary before its final Archive, so that the durable record contains the same result I saw in the conversation.
17. As a 使用者, I want a failed run to publish its failure evidence and afterRun audit before cleanup, so that diagnosis remains available after the slot is released.
18. As a 使用者, I want a halted run to be finalized like any other terminal outcome, so that stopping work does not create a half-completed lifecycle.
19. As a 使用者, I want a run that throws during dispatch to be finalized exactly once, so that exceptions cannot bypass Archive, `onSettled`, release, or queue drain.
20. As a 使用者, I want a run cancelled by its `runId` to affect only that run, so that concurrent work remains available and correctly presented.
21. As a 使用者, I want each terminal Task run to create at most one Archive record, so that Records does not show duplicate executions for one piece of work.
22. As a 使用者, I want each terminal Task run to invoke `onSettled` at most once, so that callers do not send duplicate notifications or mutate state twice.
23. As a 使用者, I want capacity to be released only after finalization, so that a new queued run cannot overtake the outgoing run's summary and Archive.
24. As a 使用者, I want queue drain to happen only after release, so that the next run sees accurate capacity and cannot be started twice.
25. As a 使用者, I want a queue drain callback to re-enter the coordinator rather than a legacy implementation, so that replenished runs preserve the canonical lifecycle.
26. As a 使用者, I want background delegate completion to link to its one execution Archive, so that the parent thread is notified without creating a duplicate execution record.
27. As a 使用者, I want legacy integrations to keep working while the lifecycle is migrated, so that compatibility does not require a second source of truth.
28. As a 使用者, I want new code to have one obvious lifecycle API, so that future features cannot accidentally bypass admission or finalization.
29. As a maintainer, I want the coordinator interface to hide store, queue, hook, attachment, and runner details, so that lifecycle rules have high locality and can evolve in one module.
30. As a maintainer, I want the legacy module to contain only compatibility and runner-specific implementation, so that its name no longer suggests ownership of the whole Task run lifecycle.
31. As a maintainer, I want terminal ordering to be explicit and observable, so that smoke failures identify which lifecycle step was duplicated or skipped.
32. As a maintainer, I want all entry points to be checked for direct legacy dispatch, so that the canonical-ingress rule remains enforceable after refactoring.
33. As a maintainer, I want default single-run behavior to remain unchanged, so that this deepening fulfills ADR-0003 without changing rollout defaults.
34. As a maintainer, I want opt-in concurrent runs to preserve run-scoped activity, HITL, cancel, and queue semantics, so that the refactor strengthens ownership without weakening concurrency isolation.

## Implementation Decisions

- The public lifecycle seam is `taskRunCoordinator.runTask`; it is the only interface new product code may use to start a Task run.
- The coordinator owns request normalization, run identity, capacity check/reservation, queue decision, attachment preparation, thread binding, beforeRun evaluation, dispatch snapshot construction, adapter invocation, terminal finalization, capacity release, and queue drain.
- The coordinator invokes runner adapters through the existing dispatch boundary. Built-in and external runners keep their execution-specific behavior and capability matrix; they do not own Archive, `onSettled`, release, or drain.
- `RunDispatchSnapshot` remains immutable from the caller's perspective and carries the run identity, thread identity, objective, runner choice, attachments, and runtime overrides needed by the adapter.
- `finalizeTaskRun` remains the single finalization implementation. Its observable order is: terminal thread summary/bubbles, afterRun hooks, Archive, `onSettled`, capacity release, then queue drain.
- Early rejection before admission is not an accepted execution and must not reserve capacity or create an execution Archive. Once admission has happened, hook denial and dispatch exceptions use the normal coordinator finalization path with a terminal failed outcome.
- `runExternalObjective` becomes a compatibility adapter to `taskRunCoordinator.runTask`. It may retain runner-specific helpers and input/result types, but it must not make lifecycle decisions independently.
- Queue drain re-enters `taskRunCoordinator.runTask` with the persisted request and `_fromQueue` marker. It must not call the legacy implementation directly.
- Existing source kinds, trigger validation, unattended behavior, runner capability declarations, background worker-thread semantics, and default `concurrentRunsEnabled: false` remain unchanged.
- No new UI surface is required. Existing thread, activity, HITL, Archive, and queue consumers observe the same result contract through the coordinator.
- The refactor may introduce private coordinator helpers or move implementation-only helpers between modules, but it must not expose a second public lifecycle seam.

## Testing Decisions

- Tests observe behavior through `taskRunCoordinator.runTask`, not through private helpers, store internals, direct calls to `runExternalObjective`, or assertions about collaborator call counts.
- The primary seam is the existing run-task scenario harness; it should exercise real coordinator and runner modules with only genuine system boundaries (time, filesystem, Electron/CLI transport, and notification) controlled.
- Each vertical slice follows red → green: first add one failing observable lifecycle contract, then implement only enough coordinator behavior to pass it, then continue to the next slice. Refactoring follows the TDD slices and is reviewed separately.
- Required behavior cases are: successful built-in run; external CLI run; hook denial; dispatch exception; cancellation; queued overflow and later drain; duplicate/re-entrant `runId`; attachment persistence/hydration; and background delegate link-only Archive.
- The real renderer seam is exercised by `npm run smoke:coordinator` through Vite + Playwright. It covers built-in success, external CLI failure, hook denial, cancellation, queue drain, duplicate `runId`, attachment input, hidden delegate execution, exactly-once `onSettled`, and Archive evidence/order; source contracts retain the dispatch-exception finalization guard.
- The strongest assertions are event/order and externally visible counts: one terminal result, one Archive, one `onSettled`, one release, one drain, correct run/thread identity, and no adapter-owned finalization.
- Prior art is the repository's scenario E2E, production-module smoke contracts, capability smoke contracts, and the existing task-agent lifecycle matrix. The new contracts should extend those seams rather than create a parallel unit-test framework.
- The final verification remains `npm run smoke`, `npm run build`, and `npx oxlint src` from `app/`.

## Out of Scope

- Changing ADR-0003's default-off concurrency rollout, cap range, queue policy, or run-scoped HITL/presentation design.
- Rewriting the built-in engine, Hermes tool loop, external CLI protocol, capability matrix, or approval policy.
- Introducing a new inline HITL UI or a new Archive schema.
- Replacing the existing smoke harness with a new test runner.
- Solving the separate single-tool-gate, Context Governor, real-source smoke import, or speculative RunContext candidates from the architecture review.
- Enabling external CLI `continueGoal` capabilities without its existing prompt contract and fixture.
- Removing the legacy export in the same change if downstream compatibility requires it; the compatibility adapter may remain while the coordinator becomes the only implementation owner.

## Further Notes

- The handoff identifies this as the strongest architecture candidate and notes that it completes, rather than contradicts, ADR-0003.
- The lifecycle integration plan already describes the intended ownership and ordering; this spec turns that intended contract into an enforceable implementation seam.
- The definition of done is satisfied only when source-contract checks show no new direct lifecycle entry into the legacy implementation, all terminal paths pass through one finalizer, and the full smoke/build/lint gates pass.
