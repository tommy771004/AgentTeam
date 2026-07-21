# Task run single-owner lifecycle cleanup

Status: resolved

## Problem Statement

使用者需要每一個已 admitted 的 Task run 都由同一個 module 負責 capacity、執行結果與 terminal finalization。現有 coordinator migration 已讓所有產品入口進入 `runTask`，也建立了唯一的 finalization 順序；但 Built-in Loop run 與 External CLI run 的執行 module 仍保留 transitional fallback，包含再次 reserve capacity、依 control flag 決定是否 Archive、release capacity 與 drain queue。

這些 fallback 讓 Task run module 的 interface 仍洩漏 lifecycle ownership。維護者必須理解 coordinator、runner selection、execution store 與 control flag 之間的隱含協議，才能確保同一個 run 不會被 reserve、Archive、release 或 drain 兩次。這降低 locality，也讓 ADR-0003 的 per-`runId` concurrency invariants 分散在多個 module。

## Solution

完成 single-owner lifecycle deepening：Task run module 是 admission 與 finalization 的唯一 owner；Built-in 與 External CLI module 只執行 Loop run 並回傳 outcome。移除 execution module 內的 duplicate reserve 與 fallback finalization，刪除跨 seam 傳遞的 lifecycle-control plumbing，並讓 runner selection 只接受 coordinator 建立的 immutable dispatch snapshot。

所有行為驗證以 `runTask` 作為最高 test seam。測試觀察 terminal outcome、Archive、`onSettled`、capacity release、queue drain 與 run/thread identity，不依賴 private helper、註解順序或 transitional control flag。只保留最小 static drift guard，防止新的產品入口或 execution adapter 再次取得 lifecycle ownership。

## User Stories

1. As a 使用者, I want each Task run to reserve capacity exactly once, so that available capacity remains accurate.
2. As a 使用者, I want a Built-in Loop run to execute without owning Task run admission, so that execution and lifecycle rules cannot diverge.
3. As a 使用者, I want an External CLI run to execute without owning Task run admission, so that runner choice does not change capacity semantics.
4. As a 使用者, I want every admitted Task run to finalize exactly once, so that completion is stable and understandable.
5. As a 使用者, I want each Task run to create at most one Archive record, so that Records never contains duplicate executions.
6. As a 使用者, I want `onSettled` to run at most once, so that scheduled jobs and gateway callers do not mutate their state twice.
7. As a 使用者, I want capacity released after terminal evidence is recorded, so that the next run cannot overtake incomplete finalization.
8. As a 使用者, I want queue drain to start only after capacity release, so that queued work observes the real available slot count.
9. As a 使用者, I want Built-in success to preserve its current thread summary and Archive outcome, so that architecture cleanup does not change visible behavior.
10. As a 使用者, I want Built-in failure to preserve its failure evidence and cleanup, so that errors cannot strand a running thread.
11. As a 使用者, I want Built-in cancellation to affect only the targeted `runId`, so that concurrent work remains isolated.
12. As a 使用者, I want External CLI success to preserve its current completion result, so that lifecycle cleanup does not imply unsupported DoD behavior.
13. As a 使用者, I want External CLI failure to retain its provider error and normal cleanup, so that runner failures remain diagnosable.
14. As a 使用者, I want External CLI cancellation to remain run-scoped, so that cancelling one CLI process cannot terminate another run.
15. As a 使用者, I want hook denial after admission to use the same finalization path, so that denied work does not leak capacity.
16. As a 使用者, I want dispatch exceptions to use the same finalization path, so that thrown errors cannot bypass Archive or release.
17. As a 使用者, I want a duplicate `runId` rejected before a second execution begins, so that single-owner cleanup does not weaken re-entry protection.
18. As a 使用者, I want queued runs to re-enter through `runTask`, so that replenished work receives the same lifecycle guarantees.
19. As a 使用者, I want cleared or removed queued work to keep its existing cancellation settlement, so that never-admitted work remains distinct from admitted-run finalization.
20. As a 使用者, I want default single-run behavior to remain unchanged, so that the cleanup does not alter rollout semantics.
21. As a 使用者, I want opt-in capped concurrency to remain unchanged, so that ADR-0003 continues to govern capacity.
22. As a 使用者, I want run-scoped HITL and activity to retain their `runId` and `threadId`, so that concurrent runs do not leak identity.
23. As a 使用者, I want hidden delegate threads to preserve their current behavior, so that background work does not steal conversation focus.
24. As a maintainer, I want one module to own lifecycle ordering, so that lifecycle changes have high locality.
25. As a maintainer, I want runner adapters to expose execution outcomes rather than lifecycle switches, so that their interface is smaller and deeper.
26. As a maintainer, I want the deletion of execution fallback code to make complexity disappear, so that no duplicate implementation remains elsewhere.
27. As a maintainer, I want the runner-selection seam to accept only coordinator snapshots, so that callers cannot invent partial lifecycle context.
28. As a maintainer, I want lifecycle tests to cross the `runTask` interface, so that internal refactors do not require rewriting implementation-pinned assertions.
29. As a maintainer, I want minimal static guards for dependency direction, so that forbidden entry paths fail quickly without replacing behavior tests.
30. As a maintainer, I want each migration slice to remain green independently, so that the cleanup stays reviewable and reversible.
31. As a maintainer, I want Built-in and CLI cleanup sequenced separately, so that runner-specific regressions are isolated.
32. As a maintainer, I want transitional lifecycle-control fields removed only after both adapters stop reading them, so that contraction cannot create a broken intermediate state.
33. As a maintainer, I want the completed coordinator migration record preserved, so that this follow-up does not rewrite project history.
34. As a maintainer, I want final verification to cover smoke, build, and lint, so that behavioral and architectural claims have fresh evidence.

## Implementation Decisions

- The Task run module remains the only public lifecycle interface for product entry points.
- The Task run module exclusively owns capacity admission, thread binding, runner dispatch, terminal summary, afterRun hooks, Archive, `onSettled`, capacity release, and queue drain.
- Built-in and External CLI execution modules become execution adapters: they consume coordinator-supplied run context and return execution outcomes.
- Execution adapters must not reserve capacity, Archive a Task run, release capacity, or drain the run queue.
- The existing runner selection seam remains; it accepts only an immutable coordinator-built dispatch snapshot.
- Transitional lifecycle-control fields are removed after both execution adapters stop depending on them.
- The compatibility entry may remain as a leaf adapter, but it must not recover lifecycle ownership.
- Never-admitted queue cancellation remains owned by the run queue module and is not folded into admitted-run finalization.
- Existing trigger validation, attachment preparation, background delegate behavior, source-kind policy, and runner capability declarations remain unchanged.
- ADR-0003 remains authoritative: concurrency defaults off, the configured cap remains bounded, capacity is per `runId`, and HITL/cancel/activity remain run-scoped.
- No new runtime dependency, UI surface, Archive schema, or settings field is introduced.
- The work lands as four sequential tracer bullets: Built-in cleanup, CLI cleanup, contract contraction, then verification contraction.

## Testing Decisions

- The primary test seam is the existing `taskRunCoordinator.runTask` interface exercised through real production-module and browser smoke harnesses.
- Tests assert observable lifecycle outcomes rather than private helper calls, source comments, internal branch names, or collaborator call counts.
- Built-in coverage includes success, failure, cancellation, exactly-once Archive/settlement, release-before-drain, and preserved run/thread identity.
- External CLI coverage includes success/failure outcome semantics, targeted cancellation, exactly-once Archive/settlement, and release-before-drain.
- Shared coverage includes hook denial, dispatch exception, duplicate `runId`, queue replenishment, and ADR-0003 capped concurrency behavior.
- The run queue cancellation test remains separate because cleared/removed items were never admitted.
- Static source checks are retained only where behavior tests cannot cheaply prove dependency direction: product entry points must use the Task run module, runner adapters must not call lifecycle finalization, and legacy compatibility must remain a leaf.
- Existing scenario smoke and production-module smoke are prior art; no new test runner is introduced.
- Each ticket begins with a failing or tightened test at the highest available seam, then changes implementation, then runs targeted verification.
- Final verification is the complete smoke suite, TypeScript/Vite build, targeted lint, and diff checks.

## Out of Scope

- Changing concurrency defaults, cap range, queue/steer policy, or ADR-0003.
- Changing the Built-in agent engine execution algorithm.
- Changing External CLI prompt contracts, DoD capabilities, or provider authorization.
- Redesigning HITL, activity presentation, thread UI, or Records UI.
- Combining admitted-run finalization with never-admitted queue cancellation.
- Retiring all legacy Task run types and OpenCode mapping responsibilities; that is a separate architecture candidate.
- Deepening context-transition governance, tool invocation, or capability lifecycle.
- Replacing the smoke infrastructure with a unit-test framework.

## Further Notes

- This is a follow-up to the completed `task-run-coordinator-deepening` effort. It contracts transitional execution fallback that remained after the coordinator became canonical.
- The deletion test is decisive: removing duplicate runner finalization makes complexity disappear because the Task run module already owns the same behavior.
- The current uncommitted run-queue settlement refactor is complementary and must be preserved.
- Completion requires zero production execution path that can independently reserve and finalize the same admitted Task run.

