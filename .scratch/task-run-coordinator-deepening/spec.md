# 深化 Task run coordinator

Category: enhancement
Status: 不處理

## Problem Statement

使用者需要每一個 Chat turn、排程、Webhook、Telegram、重試與背景委派都遵守同一份 Task run 生命週期契約：正確判斷是否可執行、保存 trigger evidence、建立或沿用 thread、選擇 runner、只完成一次 finalization，並在結束後正確釋放 capacity 與 drain queue。

目前所有產品入口雖然已經呼叫 canonical `runTask` interface，但 Task run module 的 implementation 仍反向委派給 legacy lifecycle module；legacy module 又呼叫 coordinator 暴露的多個 phase interface。理解或修改一次 Task run，仍要在 canonical module、legacy module 與 runner dispatch module 之間來回追蹤。這個 circular seam 讓 nominal owner 與實際 owner 不一致，也迫使 smoke tests 以 source-shape assertions 保護 wiring，而非從 `runTask` 觀察完整外部行為。

對使用者而言，風險不是多一個檔案，而是生命週期保證缺乏 locality：任何 admission、queue、trigger、attachment、thread、hook 或 terminal-order 變更，都可能只改到其中一半，導致不同入口出現不同結果、重複副作用，或 queue 無法繼續。

## Solution

完成既有 Task run coordinator migration，讓 Task run module 真正擁有 admission 到 finalization 的完整 implementation，並讓 `runTask` 成為所有 caller 與測試共用的唯一外部 interface。

Task run module 會隱藏 busy policy、trigger validation、automation suggestion、attachment preparation、capacity reservation、thread binding、beforeRun、dispatch snapshot、runner selection handoff、afterRun、Archive、settlement、capacity release 與 queue drain 的 orchestration。Runner dispatch 保留為 internal seam，只接收已完成 admission 的 immutable snapshot 並選擇 builtin 或 external adapter。Legacy lifecycle interface 與 reverse dependency 會被移除，而現有產品行為、ADR-0003 concurrency、runner capability matrix、run-scoped HITL 與 trigger evidence 規則保持不變。

## User Stories

1. As a 使用者, I want every Chat turn to enter one Task run lifecycle, so that execution behavior is consistent regardless of the current page.
2. As a 使用者, I want slash commands to use the same Task run lifecycle as the composer, so that they do not bypass admission or finalization rules.
3. As a 使用者, I want retries to preserve the original Task run contract, so that retrying does not create a second lifecycle implementation.
4. As a 使用者, I want scheduled work to use the same Task run lifecycle, so that capacity, Archive and settlement remain consistent with interactive work.
5. As a 使用者, I want Webhook-triggered work to use the same Task run lifecycle, so that external ingress cannot bypass safety or terminal ordering.
6. As a 使用者, I want Telegram-triggered work to use the same Task run lifecycle, so that remote ingress receives the same guarantees as local ingress.
7. As a 使用者, I want background delegates to use the same Task run lifecycle, so that hidden worker threads and Archive links remain correct.
8. As a 使用者, I want SubDesign builds and critique rounds to use the same Task run lifecycle, so that design work cannot drift from general task behavior.
9. As a 使用者, I want an empty objective with valid attachments to retain the current attachment-analysis behavior, so that the architecture change does not break file-only requests.
10. As a 使用者, I want an invalid empty Task run to fail before capacity reservation, so that it does not consume a run slot.
11. As a 使用者, I want Time-based execution to require a claimed ScheduledJob snapshot, so that conversation wording alone cannot execute scheduled work.
12. As a 使用者, I want Proactive execution to require matcher-produced event evidence, so that arbitrary objective text cannot impersonate an event.
13. As a 使用者, I want cron or event wording in conversation to remain an AutomationSuggestion, so that creating automation remains consent-first.
14. As a 使用者, I want trigger validation to happen before capacity reservation, so that invalid automation cannot block legitimate work.
15. As a 使用者, I want attachments to be materialized once and hydrated only after admission, so that queued work remains stable without duplicate filesystem work.
16. As a 使用者, I want a Task run to reserve capacity exactly once, so that concurrent work respects the configured limit.
17. As a 使用者, I want default single-run behavior to remain unchanged, so that this refactor does not alter the product rollout.
18. As a 使用者, I want opt-in concurrent Task runs to remain capped and isolated by `runId`, so that parallel work is predictable.
19. As a 使用者, I want two Task runs for the same thread to retain the current busy policy, so that thread continuity is not corrupted.
20. As a 使用者, I want overflow work to retain FIFO queue behavior, so that accepted work runs in a predictable order.
21. As a 使用者, I want interactive busy work to retain queue, steer or reject semantics, so that the migration does not change established controls.
22. As a 使用者, I want automation work to retain unattended behavior, so that it cannot block indefinitely on human interaction.
23. As a 使用者, I want project context to be captured at admission, so that queued work executes against the intended project.
24. As a 使用者, I want the Task run to create or reuse one thread before dispatch, so that messages, status and Archive point to the same conversation.
25. As a 使用者, I want hidden worker threads to remain hidden and not steal active-thread focus, so that background delegates do not disrupt the UI.
26. As a 使用者, I want beforeRun hooks to execute once, so that policy checks and audits cannot be duplicated by runner selection.
27. As a 使用者, I want a denied beforeRun hook to settle cleanly, so that capacity is released and queued work can continue.
28. As a 使用者, I want the selected runner to receive one immutable dispatch snapshot, so that admission facts cannot drift during execution.
29. As a 使用者, I want builtin Loop runs to retain parse, DoD, iterate, continueGoal and progressive capabilities, so that coordinator deepening does not reduce builtin behavior.
30. As a 使用者, I want external CLI runs to remain truthfully labeled without builtin DoD guarantees, so that a successful process exit is not misrepresented.
31. As a 使用者, I want cancellation and activity to remain scoped by `runId`, so that one concurrent Task run cannot control another.
32. As a 使用者, I want HITL requests and session approval to retain their existing run and thread scope, so that authorization does not leak between tasks.
33. As a 使用者, I want each terminal Task run to produce one summary and one Archive outcome, so that history remains trustworthy.
34. As a 使用者, I want afterRun hooks to execute once and in the established order, so that audits see the final result without duplication.
35. As an automation owner, I want `onSettled` to execute once even after queued catch-up work, so that a ScheduledJob cannot remain marked as running.
36. As a 使用者, I want capacity release to occur after settlement, so that a new Task run cannot overlap unfinished terminal side effects.
37. As a 使用者, I want queue drain to occur only after capacity release, so that the next Task run sees accurate capacity.
38. As a 使用者, I want finalization failures that are non-critical to avoid stranding capacity, so that Archive or presentation errors cannot deadlock the app.
39. As a developer, I want one Task run interface for every product ingress, so that lifecycle fixes have leverage across all callers.
40. As a developer, I want lifecycle phase knowledge to remain inside the Task run module, so that callers cannot assemble partial or invalid runs.
41. As a developer, I want runner dispatch to accept only admitted snapshots, so that it cannot accidentally perform capacity, attachment or finalization work.
42. As a developer, I want Task run input and result contracts owned by the Task run module, so that the canonical module does not depend on legacy lifecycle types.
43. As a developer, I want the legacy lifecycle interface removed, so that new callers cannot reintroduce the reverse dependency.
44. As a reviewer, I want behavioral tests through `runTask`, so that implementation movement does not require rewriting tests.
45. As a reviewer, I want tests to prove every ingress preserves the same lifecycle invariants, so that source-shape checks are not the only drift protection.
46. As a reviewer, I want tests to prove each terminal side effect occurs once and in order, so that exactly-once claims are evidence-backed.
47. As a reviewer, I want tests for builtin and external adapters behind the same Task run interface, so that runner variation does not create a second lifecycle.
48. As a maintainer, I want deleting the legacy lifecycle module to reduce indirection rather than spread complexity, so that the completed migration increases depth and locality.

## Implementation Decisions

- The Task run module is the sole external seam for task admission and lifecycle execution. Its external interface remains `runTask`; product callers do not receive phase-level interfaces.
- The Task run module owns its input, result, source-kind and lifecycle contract types. It must not import those contracts from the legacy lifecycle implementation.
- The complete orchestration moves behind the Task run interface: objective normalization, automation suggestion detection, trigger validation, attachment persistence and hydration, busy policy, capacity admission, thread binding, project snapshot, hooks, dispatch snapshot creation, terminal presentation, Archive, settlement, capacity release and queue drain.
- Runner dispatch remains an internal seam because two real adapters exist: builtin Loop execution and external CLI execution. It receives an immutable admitted snapshot and returns one runner outcome; it does not reserve capacity, prepare attachments, bind threads, evaluate lifecycle hooks, write terminal presentation, Archive, settle jobs, release capacity or drain queues.
- The deprecated unsnapshotted runner-dispatch interface is removed. Tests and production callers use the admitted snapshot path only.
- The legacy external lifecycle function and its compatibility `runTask` adapter are removed after all remaining internal orchestration is absorbed by the Task run implementation. No canonical-to-legacy dynamic import or legacy-to-canonical phase import remains.
- Phase functions become implementation details unless a second real caller or adapter requires a seam. Test convenience alone does not justify exporting admission, capacity, attachment, binding, hook or finalization phases.
- Queue drain re-enters through the same `runTask` interface with the existing queue-drain source identity. It cannot call runner dispatch or a lifecycle phase directly.
- Existing source-kind behavior remains stable for composer, slash, retry, schedule, webhook, Telegram, event, delegate and queue-drain ingress.
- Existing trigger semantics remain stable: conversation classification emits only Turn-based or Goal-based execution; Time-based requires claimed ScheduledJob evidence; Proactive requires event-matcher evidence.
- Attachment semantics remain two-phase and queue-safe: persistence occurs before a queued payload can lose renderer-only data, while hydration occurs only for an admitted run. Each phase executes at most once per Task run.
- ADR-0003 remains authoritative. Default single-run behavior, opt-in capped concurrency, per-thread busy protection, FIFO queueing, run-scoped presentation and cancellation, single FIFO HITL presentation, and thread-scoped session approval do not change.
- The runner capability matrix remains authoritative. Builtin adapters retain parse, DoD, iterate, continueGoal and progressive capabilities; external CLI adapters retain their truthful reduced capability declaration.
- Finalization preserves the established order: terminal thread presentation, afterRun evaluation, Archive, `onSettled`, capacity release, then queue drain. Existing success-only Learning behavior remains unchanged and is not relocated unless required to preserve current semantics.
- Terminal cleanup uses one owner and one drain guard per Task run. Error handling must preserve the invariant that capacity release and queue drain cannot be skipped by non-critical presentation, hook, Archive or settlement failures.
- Background delegate behavior remains unchanged: coordinator-owned runs link to one Archive result, hidden worker threads stay hidden, and nested non-coordinator execution retains only the currently supported synthetic path.
- The migration is behavior-preserving. User-visible copy, settings, storage schemas, runner selection rules and task outcome meanings change only if required to remove the circular seam without altering observable results.
- Documentation is updated to describe the completed ownership model and must no longer characterize the legacy module as the lifecycle implementation behind the coordinator.

## Testing Decisions

- A good test observes behavior through the highest seam: `runTask` input, runner invocation, thread outcome, Archive outcome, settlement callback, capacity state and queue progress. Tests must not assert private function names, dynamic-import shapes, module line placement or internal phase ordering beyond externally required side effects.
- The Task run module is tested through its `runTask` interface. Admission helpers and finalization helpers are not separate public test surfaces.
- Runner dispatch is tested as an internal seam only for the variation it owns: selecting builtin versus external adapters from an admitted immutable snapshot and returning the correct runner outcome.
- Extend the existing scenario E2E harness as the primary prior art for busy policy, concurrency caps, queue FIFO, steer behavior, source kinds, targeted cancellation and terminal settlement.
- Extend production-module smoke tests where real module imports are needed to prove objective normalization, trigger evidence preservation, immutable snapshot construction and deterministic results without pulling the full renderer graph.
- Replace lifecycle source-shape assertions with behavioral contract cases wherever the same guarantee can be observed through `runTask`. Retain one narrow drift guard that forbids product callers from importing legacy lifecycle or runner-dispatch entry points.
- Cover every ingress family at least once: interactive composer or slash, retry, ScheduledJob, Webhook/event evidence, Telegram or equivalent unattended ingress, background delegate, and queue drain.
- Cover an attachment-only request, invalid empty request, invalid Time-based trigger and invalid Proactive trigger. Assert that invalid triggers do not reserve capacity or dispatch a runner.
- Cover attachment persistence before queueing and hydration after admission. Assert that each phase executes at most once and queued attachments remain usable.
- Cover default single-run behavior and opt-in concurrency at the configured cap. Assert same-thread protection and cross-thread parallelism remain unchanged.
- Cover queue, steer and reject results through `runTask`, including a queued run that later re-enters through the canonical interface and settles once.
- Cover beforeRun allow, deny and error outcomes. Assert one evaluation, no dispatch on deny, one settlement, capacity release and continued queue progress.
- Cover builtin and external adapter selection with the same admitted Task run setup. Assert their declared capability differences remain visible in the final outcome.
- Cover successful, failed, denied, aborted and suggested terminal outcomes. Assert one thread result, one afterRun evaluation, one Archive decision, one `onSettled`, one release and one drain attempt as applicable.
- Cover non-critical failures in thread presentation, afterRun, Archive and settlement separately. Assert cleanup invariants still hold and no duplicate finalization occurs.
- Cover background delegates using coordinator ownership. Assert one hidden worker thread, one linked Archive result and no duplicate synthetic Archive.
- Run the existing full verification sequence after the migration: production-module smoke, capability smoke, scenario E2E, marketplace smoke, TypeScript build and oxlint.

## Out of Scope

- Changing ADR-0003’s default single-run setting, concurrency range, FIFO queue model, steer policy or HITL presentation.
- Redesigning per-thread approval UI, session-allow scope, cancellation UI or execution presentation.
- Changing Time-based, Proactive or AutomationSuggestion product semantics.
- Adding new runner kinds, enabling unsupported external CLI capabilities, or changing the runner capability matrix.
- Refactoring the AgentLoopEngine, capability system, tool registration, SubDesign runtime or Content Publishing adapters except for the minimum import changes required by the coordinator migration.
- Changing Definition of Done evaluation, Learning semantics, Archive schema, thread storage schema or settings schema.
- Introducing a new dependency, event bus, workflow framework or persistence module.
- Splitting the Task run lifecycle across multiple new seams for test convenience.
- Rewriting unrelated source-shape smoke tests that do not protect Task run lifecycle ownership.

## Further Notes

- This spec uses the product language from the domain glossary: a Chat turn may initiate a Task run, while a Loop run is the builtin or external execution selected inside that Task run.
- The intended architecture already exists in the lifecycle plan and repository guidance; this spec finishes the migration rather than proposing a new product model.
- The deletion test is the acceptance lens: after completion, removing the legacy lifecycle module must not move lifecycle complexity into callers. It should remove indirection because the complexity is concentrated behind the Task run interface.
- One adapter would make a hypothetical seam; runner dispatch remains a real seam because builtin and external CLI adapters both exist. Other phase interfaces stay internal unless real variation appears.
- The interface is the test surface. A test that needs to import an admission or finalization phase indicates the Task run module has not yet achieved the intended depth.
- Prototype primary source: branch `codex/prototype-task-run-lifecycle`, commit `03e0bf3`. Verdict: one lifecycle owner preserves legal transitions and exactly-once cleanup when finalization is explicit and ordered, capacity remains held through settlement, release precedes FIFO drain, invalid triggers reject before reservation, duplicate `runId`s cannot gain a second owner, and non-critical terminal failures are recorded without short-circuiting cleanup.

## Comments

> *This was generated by AI during triage.*

此項目已在 branch `codex/task-run-coordinator-tdd` 的 commit `92a65e4` 完成並完整驗證。實作已將 canonical `taskRunCoordinator.runTask` 集中為 Task run lifecycle owner，並以 production smoke、capability smoke、scenario E2E、TypeScript build 與 oxlint 驗證。因工作已完成，本項目以 `不處理` 結案並直接指向既有實作，不建立 `.out-of-scope` 紀錄。
