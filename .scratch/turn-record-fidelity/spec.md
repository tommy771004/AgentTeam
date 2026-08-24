# Turn Record fidelity: one durable ledger behind the answer, the history, and the UI Projection

Status: 可交給代理

Source: this session's live bug (`piHostProtocol` settled a turn on its FIRST assistant message, publishing the opening narration and discarding the 9,902-character conclusion — fixed by `piTurnFinalAnswer`, guarded by `scripts/smoke-pi-turn-final-answer.mts`) plus a source-level comparison against `deepseek-ai/deepseek-harness` @ `b150a55` (`docs/research/deepseek-harness-turn-record-comparison.md`). Distinct from `.scratch/harness-gap-closure/`, which owns spill, `smoke.mjs` re-implementations, fork/rerun, and the governance productisation — this effort owns the record itself.

## Problem Statement

A user ran a long analysis task. The Pi Core tool loop narrated («我先探索本地專案結構，然後研究 hermes-agent 的架構。»), called 40 tools, and wrote a full report. The chat showed the narration and nothing else. The conclusion existed — it was recoverable from Pi's own session file — but the product had thrown it away at three separate places on the way to the screen, and every surface the user could see agreed with each other that the run had succeeded.

That is not one bug. It is the predictable outcome of having no single durable record that the answer, the model's own history, and the UI all derive from:

- **The settled answer was picked, not derived.** A turn's items are every assistant message it produced; the Host took `.find()` — the first one. A tool-using turn always narrates first, so the more work a run did, the more certain it was to publish the wrong text.
- **The same wrong value poisoned the thread's history.** It was written into the Host session's `messages`, so the next turn's context recorded that the assistant had said only the preamble.
- **The chat bubble is authored in the renderer.** `taskRunCoordinator` computes `finalAgent.result || stepsTail || result.result || 狀態：<status>` and calls `pushBubble(tid,'assistant', …)`; `threadStore` persists that string to localStorage. ADR-0039 says the Pi session store and Host run journal are the sole authorities and the renderer holds a disposable UI Projection. Today the renderer holds an authored, persisted copy of the conversation, which is exactly the authority ADR-0039 forbids it to hold.
- **Nothing else could contradict it.** `SessionRecord.messages` is `{role, content}` text with no tool trace and no ordering key; `toolAudit` is a parallel array with no position in the conversation; `runActivityStore` is explicitly ephemeral (`MAX_EVENTS = 120`, terminal digest `MAX_TERMINAL_EVENTS = 40`); the persisted execution record is assembled from a four-level fallback ladder (`activityOperations` → `piHostOperations` → `finalAgent.toolCalls` → `steps + logs`) whose card kind is guessed by regex (`/write|edit|create|patch/i`). Four shapes, none of them canonical, none able to prove another wrong.
- **An empty answer reads as success.** With no assistant text at all, the run is published as `success` with the body `Pi Core 完成（無文字輸出）`, confidence `0.9`, archived, and fed to the learning loop.
- **A stopped turn returns a blob.** `interruptedTurnResult` joins every assistant fragment with `\n`, so a user who stops a run gets the opening narration welded to the partial answer with no boundary between them.
- **A finished run cannot be inspected.** There are no turn/step coordinates, so a run has no addressable interior: no per-step timing, no time-to-first-token, no way to page back through what a long run actually did once the 120-event window has rolled.

The user-visible shape of all of this is simple: *the app tells me a run succeeded, shows me the wrong text, and gives me no way to check.*

## Solution

The Pi Core Host gains one **Turn Record** — an append-only, sequence-numbered ledger of what happened in a turn, owned by the Host, persisted with the session, and versioned with the Pi Host Protocol. Every entry carries turn and step coordinates.

From that one record, three things are *derived* rather than authored:

1. **The settled answer** — the turn's last assistant text entry, computed at one place, honest about the empty and interrupted cases.
2. **The model's own history** — user text, assistant text, and the tool calls and results in the order they happened, so a resumed conversation knows what it did and not merely what it said.
3. **The UI Projection** — one pure function turns a slice of the ledger into the rendered conversation and the execution-process record. The renderer stops authoring bubbles; the coordinator stops merging four sources; card kinds stop being guessed from tool names, because tools declare what they are.

On top of the record, the run gains an inspectable interior: a Trajectory view addressed by turn and step, paged from the Host rather than capped in memory, that shows real timing and never invents a duration for work still in flight.

The user-visible outcome: the answer you see is the answer the model settled on, the app can prove it, and when something goes wrong you can walk back through the run and find where.

## User Stories

1. As a user running a long task, I want the final answer in the chat to be the model's conclusion, so that the work I waited for is the work I receive.
2. As a user, I want the narration a run makes before it starts working to stay in the execution feed rather than replace my answer, so that the chat reads as an answer and not as a status line.
3. As a user, I want a turn that produced no text at all to be reported as a problem rather than as a success, so that I retry instead of trusting an empty result.
4. As a user who stops a run mid-way, I want the partial answer presented as a partial answer with its boundary intact, so that I can tell what was concluded from what was merely being said.
5. As a user whose run was stopped by the per-turn deadline, I want the surface to say it timed out and to keep whatever was produced, so that a slow provider does not read as a failed task.
6. As a user continuing a conversation, I want the model to have its own tool history and not only its own prose, so that my follow-up does not have to re-explain what the agent already did.
7. As a user, I want the conversation to survive a renderer reload with the same content the Host has, so that the app never shows me a version of my own history that no authority holds.
8. As a user who moved machines or cleared local data, I want the conversation to rebuild from the Host, so that my history belongs to the product and not to one browser profile.
9. As a user, I want the execution process of a finished run to still be inspectable after 40 operations, so that a long run is not the one I can see least about.
10. As a user, I want to page backwards through a long run's record, so that the earliest steps are not the first thing the product forgets.
11. As a user, I want each entry in the record to say which turn and which step it belongs to, so that I can locate a failure rather than scroll for it.
12. As a user inspecting a step, I want its token usage and duration, so that I can tell an expensive step from a slow one.
13. As a user, I want an assistant span to distinguish waiting for the first token from generating the rest, so that I can tell a stalled provider from a long answer.
14. As a user watching a run in flight, I want in-progress work shown as in-progress with no duration invented for it, so that the timing I read is timing that was measured.
15. As a user, I want a file that a run created or edited to appear in its produced-files list whether or not the model remembered to mention it, so that the list reflects what happened rather than what was said.
16. As a user, I want a file that a run only read to stay out of the produced-files list, so that the list means something.
17. As a user, I want a tool's card in the feed to look like what the tool does — a command, a diff, a search result — so that I can read the run at a glance.
18. As a developer adding a tool, I want to declare how it presents once, next to its schema, so that no central switch or filename regex has to learn about my tool.
19. As a developer adding a tool, I want its presentation to be a pure function of its arguments and result, so that replaying an old record renders it identically and a malformed old entry degrades to a generic card instead of breaking the view.
20. As a developer, I want to add a new kind of record row without editing a shared renderer, so that a feature owns its own surface.
21. As a maintainer, I want the record to be the only thing the answer, the history, and the UI read from, so that a defect in one of them can no longer disagree silently with the other two.
22. As a maintainer, I want the record's ordering to come from an explicit sequence rather than from array position or map iteration, so that the display order is a decision and not an accident.
23. As a maintainer, I want a written invariant that anything the model can see is in the record, so that a future model-visible input cannot be added without a durable entry.
24. As a maintainer, I want a test that drives the Host with a scripted multi-message, tool-using turn and asserts the assembled transcript, so that the class of defect that started this effort cannot ship again.
25. As a maintainer, I want that test to assert the persisted history as well as the returned answer, so that a correct bubble built on a corrupted history still fails.
26. As a maintainer, I want the empty-answer, interrupted, timed-out, and failed settlements each asserted distinctly, so that the four cannot collapse into one another.
27. As a maintainer, I want the renderer's projection to be a pure function testable on recorded fixtures, so that UI regressions are caught without launching Electron.
28. As a maintainer, I want the four-source fallback ladder in the run summary removed rather than reordered, so that there is one answer to what a run did.
29. As a maintainer, I want the ephemeral activity store to remain a live cache and stop being the source the persisted record is built from, so that a memory cap can never truncate durable history.
30. As an operator investigating a support report, I want a run's record exportable, so that I can reason about what happened without the user's machine.
31. As an operator, I want the record to distinguish what the Host executed from what the model claimed, so that ADR-0048's execution-evidence rule holds inside the record too.
32. As a user of an external CLI runner, I want its runs to produce the same record shape as builtin runs, so that the UI does not degrade to a different, worse view for half my providers.
33. As a user of an external CLI runner, I want the record to keep saying that no builtin DoD was evaluated, so that parity of shape is never mistaken for parity of guarantees.
34. As a user, I want compaction to appear in the record at the position it happened, so that a shortened context is visible rather than silently applied.
35. As a user, I want a compaction entry to disclose what it replaced and roughly how much, so that I can judge whether the model lost something I cared about.
36. As a user, I want an approval decision to appear in the record, so that "why did it not do that" has an answer I can read.
37. As a user resuming a conversation after a Host restart, I want the record to be continuous across the restart, so that a process boundary is not a hole in my history.
38. As a maintainer, I want the record's on-disk format versioned with the Pi Host Protocol, so that an older record is either read correctly or refused loudly.
39. As a maintainer, I want an unreadable or partially-written record refused loudly at load rather than silently treated as empty, so that data loss is reported and not performed.
40. As a maintainer, I want the pure helpers that derive the answer to live in one module the Host and the renderer both import, so that the two halves cannot drift apart again.

## Implementation Decisions

**One durable record, owned by the Host.** `SessionRecord` gains an append-only, sequence-numbered entry list. Entries are a discriminated union tagged by kind — turn boundary, step boundary, user text, assistant text, tool call, tool result, approval decision, compaction checkpoint — each carrying `seq`, `turn`, `step`, and a monotonic timestamp. `messages` and `toolAudit` become derived projections of that list, not parallel truths; `toolAudit` keeps its existing shape for ADR-0048 evidence consumers and gains its position in the ledger.

**Derivation replaces selection everywhere.** `piTurnFinalAnswer` (added this session in `src/agent/piHostRun.ts`, imported by `electron/piHostProtocol.ts`) is the template and stays the single owner of "which text settled this turn". Extend the same module with the other derivations — model history, interrupted partial, empty-answer classification — so the Host and the renderer import one implementation. No consumer may re-derive an answer by indexing into items.

**Settlement becomes a closed union, and the empty case is not success.** A turn settles as `answered` (non-empty assistant text), `empty` (successful provider call, no text), `interrupted` (with `user` / `timeout` reason, carrying the partial as a distinct field from the narration), `failed`, or `cancelled`. `empty` is a retryable outcome at the Host boundary, not a success carrying `Pi Core 完成（無文字輸出）`. The renderer's status mapping and the coordinator's archive/learning path switch on the union with an exhaustive default.

**Interrupted turns keep their boundary.** `interruptedTurnResult` stops joining fragments with `\n`. The partial answer is the last assistant text entry; anything earlier stays narration in the ledger. What the user sees as "the answer so far" and what they see as "what it was saying" are two different reads of the record.

**Renderer stops authoring the conversation.** One new pure module — the projection seam — takes a ledger slice plus session metadata and returns the rendered conversation rows and the execution-process record. `taskRunCoordinator.pushBubble(tid,'assistant', …)` becomes one case inside that projection rather than the place the answer is decided, and `pushRunProcessSummary`'s four-level fallback (`activityOperations` → `piHostOperations` → `toolCalls` → `steps+logs`) is deleted in favour of the ledger. `runActivityStore` remains the live cache for in-flight rendering and stops being an input to anything persisted. `threadStore` keeps thread-local UI state (draft, view, plan) and stops persisting authored assistant content, per ADR-0039.

**Tools declare their presentation.** `ToolDefinition` (`src/agent/tools/toolDefinitions.ts`, today `description` / `keywords` / `parameters` / `owningCapability`) gains two optional pure methods and a location list:

```ts
type ToolPresentation =
  | { card: 'generic'; title: string; kind?: 'read' | 'search' | 'edit' | …; content?: string; locations?: ToolLocation[] }
  | { card: 'terminal'; title: string; description?: string; cwd?: string }
  | { card: 'diff'; title: string; diffs: Array<{ path: string; oldText: string | null; newText: string }>; locations?: ToolLocation[] }
  | { card: 'search'; shape: 'matches' | 'paths'; …; truncated: boolean }

type ToolDefinition = {
  // …existing fields
  presentCall?: (args: unknown) => ToolPresentation
  presentResult?: (args: unknown, result: { content: string; isError: boolean; meta?: unknown }) => ToolPresentation
}
```

Both must be pure functions of their inputs — they run on live streaming *and* on ledger replay, so no I/O, no session reads, no clock, no randomness. A malformed or older logged argument returns `undefined` and falls back to a generic card rather than throwing: display must never break replay. UI-only formatting (fenced console blocks, rendered diffs, relativised paths) stays out of the model-facing result. The regex `/write|edit|create|patch/i` and the `fileMap` heuristic in the coordinator are removed; produced files derive from `card: 'diff'` and `locations`, so a mutation tool joins the produced-files list by declaring what it does.

**Turn and step coordinates are first-class.** Step numbering already exists implicitly (`iteration` on `host/turn-item`, `orchestration.iterations`); it becomes explicit on every ledger entry. The Host records per-step model timing — request start, first token, completion — so time-to-first-token and decoding time are measured facts on the record rather than derived guesses. In-flight entries carry a start with no end; no consumer may synthesise a duration for one.

**Trajectory is a paged read of the ledger.** A new Host Protocol method returns a bounded page of entries for a session, addressed by `seq`, newest-first with a cursor for older pages. The renderer's Trajectory view opens at the tail, loads one older page on demand, and never holds the whole ledger. The 120/40 in-memory caps stay where they are — they now bound a cache, not the record.

**External CLI runners produce the same ledger.** The external runner path writes the same entry kinds through the same seam, so the UI has one shape. `EXTERNAL_CLI_RUNNER_CAPABILITIES` continues to declare `parse` / `validateDoD` / `iterate` false and the record carries that declaration, so identical presentation never implies identical guarantees.

**Versioning and failure posture.** The ledger format version rides the Pi Host Protocol version (ADR-0038); a record whose version the running Host does not understand is refused loudly at load rather than treated as empty. Writes append; a partially written trailing entry is detected and reported, never silently dropped.

**ADR work.** ADR-0039 (Pi Host state is canonical) is the authority this effort brings the code back into compliance with; no new ADR is needed for that. Two new ADRs are: *the model-visible surface must be reconstructable from the Turn Record* (the invariant behind user story 23), and *a tool's presentation is part of its definition and must be replay-pure*.

## Testing Decisions

**What a good test is here.** Assert what a user or a consumer can observe: the text that settles a turn, the history the next turn would read, the rows a record projects into, the settlement a stop produces. Never assert that a particular internal function was called, that entries are stored in a particular array, or that a helper has a particular name. A test that would still pass if the answer were wrong is worse than no test; a test that fails when the answer is right is a bug in the test.

**Two seams, confirmed with the user, no more.**

*Seam 1 — the Pi Host Protocol transcript (existing).* Spawn `dist-electron/pi-host.js` over stdio against a loopback model server that scripts the turn, then assert what the Host returns and what it persists. `scripts/smoke-pi-turn-final-answer.mts`, written this session, is the reference: it scripts narration + a `grep` tool call on the first completion and the conclusion on the second, then asserts both `turn/submit`'s items and `sessions/list`'s history. Prior art for the pattern: `smoke-pi-turn-success.mts`, `smoke-pi-turn-interrupt.mts`, `smoke-pi-turn-cancel.mts`, `smoke-pi-host-orchestration.mts`. This seam covers: multi-message settlement, empty answer, interrupt (user and timeout, with the partial boundary), failure, tool trace in history, ledger ordering and coordinates, paging, version refusal, and continuity across a Host restart (`smoke-pi-session-restart.mts` is the prior art).

*Seam 2 — the renderer projection function (new).* One pure function from a ledger slice to rendered rows plus the execution-process record. It is tested directly on recorded ledger fixtures — no Electron, no Zustand, no DOM. It covers: the answer row, narration staying out of it, produced files derived from `diff` cards and `locations`, reads excluded, card kinds by declared intent, malformed old entries degrading to generic, in-flight entries carrying no duration, and external-CLI records projecting to the same shape with their capability declaration intact. Prior art for pure-module smokes: `smoke-run-lifecycle.mts`, `smoke-stall-policy.mts`, `smoke-auto-continue-freshness.mts`.

**Every new smoke imports shipped modules.** Per `CLAUDE.md`, a smoke never re-implements the logic it checks and never gains a loader dependency to make an import work. The drift guards that exist (no `dispatchThreadTask` / `startExecution` from UI, no new `agent/loop` imports per ADR-0045) stay; add one asserting that no consumer outside the derivation module picks a turn's answer by indexing items.

**Coverage rule for this effort.** Any change to what a model sees or a user sees requires an assembled-transcript assertion at Seam 1 in the same change — a unit test on a helper does not substitute for it. This is the practice that would have caught the originating bug, whose only Host-level test used a single-message turn.

**Registration.** New Host smokes join the `smoke:pi-host` chain; projection smokes join `npm run smoke`. `npm run build` remains the typecheck.

## Out of Scope

- Rewriting the renderer's visual design. This effort changes where the conversation comes from, not what it looks like; a bubble that renders the same text from the projection is a success.
- Replacing Pi Core's own session file. Pi keeps its transcript; the Turn Record is the Host's product-facing ledger, not a second copy of Pi's internals.
- Spill / large tool output retrieval — owned by `.scratch/harness-gap-closure/issues/07-spill-large-tool-output.md`.
- `smoke.mjs`'s inlined re-implementations — owned by `.scratch/harness-gap-closure/issues/05-make-smoke-mjs-test-real-code.md`.
- Fork and rerun from step N — owned by `.scratch/harness-gap-closure/issues/02-fork-and-rerun-from-step.md`, though it becomes materially easier once steps are addressable.
- A plugin architecture for the renderer. Registry-shaped record rows are a design goal within the existing codebase, not an adoption of a plugin kernel.
- Provider-level retry policy, circuit-breaker changes, and stream idle watchdogs. `llmResilience.ts` and `piTurnDeadline.ts` are adequate today; only their *reporting* into the record is in scope.
- Migrating historical conversations. Existing threads keep their persisted bubbles as legacy rows; the ledger begins at adoption.

## Further Notes

- The originating defect is already fixed and guarded: `piTurnFinalAnswer` in `src/agent/piHostRun.ts`, consumed by `electron/piHostProtocol.ts` for the settled answer, the persisted history, and the DoD check; regression test `scripts/smoke-pi-turn-final-answer.mts`, registered in `smoke:pi-host`. Reverting the fix makes that smoke fail with `actual: '我先探索本地專案結構。'` — the exact screenshot. This effort generalises that fix; it does not repeat it.
- The comparison that produced this spec found the same structural rule in `deepseek-harness` stated as an invariant with a runtime assertion behind it: anything reaching a model request must be reconstructable from the append-only log. Its UI derives every row from that log through registry-registered definitions, its tools declare a render intent union with replay-pure presenters, and its testing policy requires an assembled-transcript snapshot for every model- or user-visible change. Those three, together, are why the defect class this spec addresses cannot occur there.
- Sequencing suggestion for ticket breakdown: the ledger and its derivations first (they unblock everything), then the projection seam and the deletion of the fallback ladder, then tool presentation, then trajectory and paging. The empty-answer and interrupted-boundary fixes are small and independent — they can land first as standalone tickets to stop ongoing data loss.
