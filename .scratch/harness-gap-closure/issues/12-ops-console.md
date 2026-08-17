# 12 — Merge scheduler, events, and execution into one Ops console

**What to build:** Consolidate `SchedulerPage`, `EventsPage`, and `ExecutionPage` into a single operations surface that makes the task lifecycle layer observable.

**Blocked by:** None.

**Status:** 可交給代理

The lifecycle governance layer is the strongest asset in the product and it has no screen. `taskRunCoordinator.runTask` is the sole ingress for eight `sourceKind`s, `resolveBusyPolicy` decides queue versus steer, `runQueue.ts` is a persisted FIFO with dedupe and a cap of 24, `runConcurrency.ts` is a capped registry per ADR-0003, and `runJournal.ts` provides crash recovery with an eight-state `JournalStatus`, a 300-entry ring buffer, deliberately synchronous writes, and a `RecoveryReport` that `runTask` awaits before doing anything else.

The compared harness has turns and steps but no equivalent layer — how an external event becomes a managed run, what happens when busy, what happens to in-flight runs after a crash, and who finalizes are all left blank for plugin authors there. This should be the product's first screen, not three pages nobody connects.

This is a projection of existing state. It adds no lifecycle behaviour.

- [x] One console replaces `SchedulerPage`, `EventsPage`, and `ExecutionPage` as the operations surface.
- [x] It shows current queue depth against the cap, what is running now, and remaining concurrency headroom.
- [x] It shows what was deduplicated and against which existing run.
- [x] It shows why a given run was queued rather than steered, naming the `sourceKind` and the busy-policy decision.
- [x] It shows the last startup `RecoveryReport`: which runs were `marked-interrupted`, `resume-once`, `restored`, or `quarantined`.
- [x] Each entry names its `sourceKind` — composer, slash, retry, schedule, webhook, telegram, event, or delegate.
- [x] The console reads existing coordinator, queue, concurrency, and journal state and introduces no new lifecycle behaviour or persistence.
- [x] Journal display honours the bounded-metadata rule — no prompts, no tool payloads, no credentials.
- [x] Existing routes to the three merged pages redirect rather than 404.
- [x] Behaviour confirmed manually under `npm run dev`; `npm run smoke:journal` and `npm run smoke:coordinator` stay green.

Files: `app/src/pages/SchedulerPage.tsx`, `app/src/pages/EventsPage.tsx`, `app/src/pages/ExecutionPage.tsx`, `app/src/agent/taskRunCoordinator.ts`, `app/src/agent/runQueue.ts`, `app/src/agent/runConcurrency.ts`, `app/src/agent/runJournal.ts`.

## Comments

**2026-08-17.** `OpsQueueItem.reason` was a hardcoded `'capacity'` literal, so
"why was this queued rather than steered" was unanswerable. `resolveBusyPolicy`
moved to the neutral leaf (`taskRunTypes.ts`, re-exported from `taskRunPolicy`)
so the Ops projection reads the same decision the coordinator made without
pulling the store graph. Reasons are now `automation-source` / `follow-up-mode`
/ `explicit-enqueue` / `capacity`, each with the `sourceKind` and busy-policy
decision spelled out in `reasonDetail`. `smoke:ops-console` asserts the mapping
per source kind and guards against the constant returning.
