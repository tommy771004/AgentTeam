# Interactive Follow-up Queue and Steer

Status: 可交給代理

## Problem Statement

使用者在一個 Chat turn 尚在執行時，仍需要把後續意圖交給 AgentStudio。目前 composer 只提供全域 `followUpMode`，執行中送出按鈕又被停止按鈕取代，使用者看不到已送出的 follow-up、無法逐筆決定要「引導」目前工作或「排隊」成為下一個 Chat turn，也無法在尚未派送前編輯、刪除或調整順序。

更嚴重的是，產品中的 `steer` 語意已經分裂。Builtin Pi Host 具備把輸入注入 active Pi turn 的真正 steer 能力，但 Task run coordinator 的 busy branch 目前會先中止 active Task run，再讓新 objective 接手或進入 renderer queue。這是「中止並接手」，不是 steer。Renderer 與 Pi Host 又各自保存一套 queue；若直接加入 pending cards，reload、Host restart、競態或去重時可能出現順序漂移、重複投影、已刪除項目復活，甚至同一 Pi Session 同時啟動兩個 Task runs。

External CLI run 依 frozen runner capability 不具備 in-turn steer。若 UI 對所有 runner 都顯示相同的「引導」，會把 stop/restart 包裝成不存在的能力。產品需要一份誠實、Host-owned、可恢復的 follow-up contract：Builtin Pi steer 加入同一 active Chat turn；queue 在目前 Task run terminal settlement 後成為下一個 Chat turn；External CLI 只提供它真正支援的排隊或明確標示的「中止並接手」。

## Solution

在 composer 上方加入可持續顯示的 pending follow-up cards。每張卡片呈現使用者實際輸入的 bounded preview、目前動作語意、投影狀態，以及在該狀態仍合法的編輯、刪除、重新排序或更多操作。執行中保留獨立的送出與停止控制，讓使用者可以在不中止目前 Task run 的前提下繼續輸入。

建立 versioned Host-owned Pending Follow-up contract，統一 Builtin Pi 的 steer 與同 Pi Session queue。Renderer 只從 Host snapshot 加 cursor events 建立 UI Projection，不把 localStorage 當成權威。每筆 follow-up 帶穩定 `clientMessageId`、Pi Session／conversation identity、提交時的 runner capability、動作、狀態、順序，以及 steer 所需的 expected active turn/run identity。Host 以 compare-and-accept 語意拒絕過時的 steer target，避免把訊息注入錯誤 turn。

Builtin Pi 的 steer 直接進入 active Pi turn 的 pending input，在下一個 model/tool 安全邊界交付，保留同一 Chat turn 與 Task run identity，不先停止工作。Queue 則凍結新的 Task run input，在目前 Task run 完成 unique finalization 與 terminal settlement 後，同一 Pi Session 嚴格 FIFO、一次只 admission 一筆；不同 conversations 仍可在 `maxConcurrentRuns` 內並行。

External CLI 不宣稱支援 steer。其 follow-up 預設可排隊成下一個 Task run；若產品保留現有 stop/restart 操作，UI 與結果必須明確稱為「中止並接手」，並沿用 Task run coordinator 的唯一 ingress、capacity、Outbound Data Gate 與 finalization。使用者切換 runner、reload 或 Host restart 後，已接受的項目仍依提交時 frozen capability 與 Host truth 呈現，不因新設定而改變語意。

## User Stories

1. As a user with an active Builtin Pi run, I want to submit a steer without stopping the run, so that I can refine the current work in context.
2. As a user, I want a steer delivered at a safe model/tool boundary, so that an in-flight tool operation is not corrupted.
3. As a user, I want a steer to remain part of the same Chat turn and Task run, so that one interaction is not falsely represented as two executions.
4. As a user, I want to queue a follow-up while work is running, so that I do not need to wait beside the app before describing the next task.
5. As a user, I want a queued follow-up to begin only after the current Task run reaches terminal settlement, so that intermediate model steps do not release it prematurely.
6. As a user, I want same-conversation queued follow-ups to run in FIFO order, so that later instructions cannot overtake earlier ones.
7. As a user, I want only one queued follow-up from a Pi Session admitted at a time, so that session history and tools cannot race.
8. As a user, I want different conversations to keep using available concurrency, so that ordering one conversation does not serialize the whole app.
9. As a user, I want submitted follow-ups shown above the composer, so that I can see what the Agent will receive next.
10. As a user, I want each card to retain the actual instruction preview, so that repeated generic labels do not hide what was submitted.
11. As a user, I want duplicate visible follow-ups coalesced by identity rather than text alone, so that identical intentional instructions remain possible while transport replays do not duplicate them.
12. As a user, I want each pending card to show whether it will steer, queue, or stop-and-take-over, so that the consequence is clear before dispatch.
13. As a user, I want to edit a locally pending or Host-queued instruction before dispatch, so that I can correct mistakes.
14. As a user, I want to delete a locally pending or Host-queued instruction before dispatch, so that obsolete work does not run.
15. As a user, I want to reorder multiple queued follow-ups before dispatch, so that their execution order matches my latest priority.
16. As a user, I want accepted steer cards to stop offering edit or delete actions, so that the UI does not promise an impossible recall.
17. As a user, I want rejected or stale steer submissions to remain visible with a recovery action, so that my instruction is not silently lost.
18. As a user, I want a stale steer target retried only against a confirmed current active turn, so that the message cannot enter the wrong task.
19. As a user, I want a non-steerable active operation to offer queue as an honest fallback, so that the task is retained without pretending it was injected.
20. As a user, I want the composer send action available during execution, so that the stop control is not the only action I can take.
21. As a user, I want stop to remain a separate, clearly destructive control, so that adding a follow-up cannot accidentally cancel work.
22. As a user, I want attachments submitted with a follow-up to retain the exact accepted references, so that later file changes do not silently alter queued intent.
23. As a user, I want queue capacity exhaustion reported explicitly, so that accepted-looking work is never silently dropped or evicts older work.
24. As a user, I want queued follow-ups restored after renderer reload, so that navigation does not lose accepted work.
25. As a user, I want queued follow-ups restored after Host restart, so that work which never started is not discarded.
26. As a user, I want an interrupted active run handled separately from queued work after restart, so that uncertain side effects are not replayed automatically.
27. As an External CLI user, I want the UI to omit true steer when the runner cannot provide it, so that capability claims remain honest.
28. As an External CLI user, I want stop/restart labeled「中止並接手」, so that I understand it creates a replacement Task run rather than modifying the active one.
29. As a user who changes the default follow-up setting, I want already submitted cards to keep their original action, so that queue semantics do not mutate retroactively.
30. As a keyboard user, I want to reach, inspect, edit, reorder and delete pending cards without a pointer, so that follow-up management is accessible.
31. As a screen-reader user, I want submission, rejection, dispatch and removal announced without replaying the entire queue, so that status updates remain usable.
32. As a user, I want long instructions truncated visually but available through an accessible expansion, so that cards stay compact without losing content.
33. As a maintainer, I want Pi Host to be the authority for accepted Builtin Pi follow-ups, so that renderer reload cannot overwrite newer execution state.
34. As a maintainer, I want one stable client identity per submission, so that retries, snapshot hydration and cursor replay remain idempotent.
35. As a maintainer, I want all new queued Task runs to re-enter `runTask` admission, so that capacity, attachments, Outbound Data Gate, review baseline and unique finalization remain intact.
36. As a maintainer, I want the active run identity checked atomically with steer acceptance, so that UI observation and Host mutation cannot race.
37. As a maintainer, I want live and recovered pending-card projections derived from the same Host facts, so that restart does not change ordering or action state.
38. As a maintainer, I want terminal settlement to be the only queue-release boundary, so that model-step, tool-result or activity events cannot accidentally start the next Chat turn.
39. As a maintainer, I want frozen runner capabilities attached to accepted follow-ups, so that later settings or upgrades do not rewrite historical guarantees.
40. As a maintainer, I want plain-browser degradation to retain basic queue UX without inventing Host guarantees, so that the compatibility seam remains functional and honest.

## Implementation Decisions

- **Domain meaning.** A steer is additional user input accepted into the active Builtin Pi turn and delivered at the next safe model/tool boundary. It does not terminate the active Task run and does not create a second Chat turn. A queue item is a frozen future Task run input that becomes a later Chat turn only after the prior run's terminal settlement.
- **Canonical ownership.** Pi Host owns accepted Builtin Pi steer and queue state. Renderer Zustand may cache a disposable UI Projection; renderer localStorage cannot accept, reorder, cancel, resurrect or otherwise author Host state after submission.
- **Single execution ingress.** A queued item reaching the head does not start Pi directly. Host orchestration releases one item into the existing Task run coordinator ingress, preserving capacity reservation, thread binding, attachment preparation, frozen dispatch snapshot, Outbound Data Gate and unique finalization.
- **Per-session serialization.** One Pi Session has at most one active Task run. A steer joins that active turn; a queue item becomes a later run. Different sessions remain independently concurrent within `maxConcurrentRuns`.
- **Terminal release boundary.** Same-session queue draining occurs only after the active Task run completes the existing finalization sequence and records terminal settlement. A model response, tool completion, loop iteration or provisional DoD result is not a release signal.
- **Stable identity and dedupe.** Every submission receives a client-generated stable message identity and a Host acceptance identity. Transport retry, cursor replay and reload dedupe by identity, not normalized text. Two intentionally identical prompts with different client identities remain distinct queue items.
- **Steer concurrency control.** Steer submission carries the expected active turn/run identity observed by the renderer. Host atomically checks it while accepting input. A mismatch returns the current identity or an explicit stale-target result; the client may perform one bounded retry only after refreshing Host state and confirming the user's requested action remains applicable.
- **Pending lifecycle.** UI Projection distinguishes local draft, submitting, accepted steer, Host queued, rejected, dispatching, settled and cancelled. State advances monotonically from Host snapshots/events; stale renderer events cannot move an item backward or revive a terminal item.
- **Edit and cancellation rules.** Local drafts and Host-queued items may be edited or cancelled through versioned compare-and-set mutations. Once a steer has been accepted into active pending input, or a queue item is dispatching, it is immutable and cannot advertise recall. Cancellation is idempotent and never terminates the active run unless the user separately invokes stop.
- **Ordering rules.** Queue order is Host-authored FIFO. Reorder is allowed only among mutable queued items belonging to the same Pi Session and uses an expected queue revision. Existing accepted items are never silently evicted or reordered when capacity is full.
- **Attachment semantics.** Submission freezes attachment references and the security-relevant dispatch context needed by the future Task run. Renderer previews metadata only. Host/main-process authority continues to own protected paths, tokens and resolved attachment material.
- **Capability honesty.** Builtin Pi may expose `steer` and `queue`. External CLI exposes queue; any existing abort-and-replace workflow is a separate `takeover` action with user-facing copy「中止並接手」. External CLI process success remains distinct from builtin DoD and never gains in-turn steer through UI relabeling.
- **Frozen behavior.** An accepted follow-up retains the runner kind, action and relevant run-scoped settings chosen at submission. Changing global follow-up behavior or model selection affects new composer submissions only.
- **Composer interaction.** Pending cards sit immediately above the input field and stay associated with that conversation. While a run is active, send and stop remain separate controls. The action selector uses the current runner's capabilities and the user's default only as the initial choice for a new submission.
- **Card content.** Each card shows a bounded first-line/short preview of the actual instruction, action label, state and legal controls. It does not replace content with repeated「已執行指令」or `allow` labels. Long content is expandable and duplicate transport projections collapse to one card by identity.
- **Error recovery.** Explicit outcomes cover stale target, no active turn, non-steerable turn, queue full, Host unavailable, rejected mutation and lost capability. An unaccepted instruction remains recoverable in the composer or rejected-card state; the UI never reports acceptance before Host acknowledgement.
- **Restart behavior.** Queued items survive Host restart through the canonical journal/snapshot owner. An active run interrupted during restart follows the existing Replay-safe Checkpoint policy; its uncertain work is not converted into a fresh queued item automatically. Renderer reload obtains a snapshot and resumes events after a cursor.
- **Queue consolidation.** The existing renderer capacity queue may remain for plain-browser or non-Host compatibility during migration, but it cannot be a second authority for Builtin Pi same-session follow-ups. Migration needs explicit ownership routing and removal of dual-write behavior before the cards are considered complete.
- **Turn Record boundary.** Accepted user input and resulting lifecycle changes continue to appear in the Host-owned conversation/Turn Record at their truthful boundary. Pending queue management state is not model-authored prose and must not be reconstructed by parsing transcript bubbles.
- **Accessibility and visual language.** Cards reuse the existing compact composer geometry, typography, icon language, focus treatment and Traditional Chinese/English vocabulary. Controls have labels and keyboard support; reordering has non-drag alternatives; reduced motion leaves all content visible.
- **ADR alignment.** The design preserves Host canonical state, durable journal ownership, per-Pi-Session serialization, Task run coordinator ingress, bounded global concurrency and replay-safe restart semantics. It corrects the current abort-based steer path rather than adding a second lifecycle owner.

## Testing Decisions

- **Primary seam: public composer follow-up submission through Task run coordinator admission and Pi Host Protocol.** One highest-level gated behavior suite submits follow-ups as the real composer/controller would, observes Host acknowledgements and UI Projection, then advances the real run lifecycle. It must not reproduce queue or steer rules in a test-only reducer.
- **True steer behavior.** With an active Builtin Pi turn paused across a controlled tool boundary, submit steer with the expected active identity. Assert the original Task run is not stopped, the run/turn identity remains stable, and the input reaches the next model request exactly once.
- **Stale-target behavior.** Change the active turn between projection and submission. Assert atomic rejection, one bounded refresh/retry where applicable, no delivery into the stale turn and no duplicate after cursor replay.
- **Non-steerable behavior.** Exercise a Host operation that refuses steer. Assert the UI reports the rejection and offers queue without silently converting action or discarding text.
- **FIFO settlement behavior.** Queue at least three same-session inputs while a run is active. Emit intermediate model/tool/iteration events and assert none starts. Complete terminal finalization and assert exactly the first item enters `runTask`; repeat to prove strict one-at-a-time FIFO.
- **Cross-session concurrency.** Keep one session active with queued work while another has capacity. Assert the second session can run independently and the first session's queue ordering remains unchanged.
- **Mutation behavior.** Through public Host mutations, edit, cancel and reorder mutable queue items with queue revisions. Assert stale revisions fail without partial mutation; accepted steer and dispatching items expose no successful edit/cancel path.
- **Idempotency behavior.** Retry a submission, replay cursor events and reload the renderer with the same client identity. Assert one Host item and one card. Submit identical text with a new identity and assert two ordered cards.
- **Capability behavior.** Run the same surface with frozen Builtin Pi and External CLI capabilities. Assert Builtin offers steer/queue; External CLI omits steer and labels abort-and-replace「中止並接手」without claiming same-turn delivery.
- **Composer rendering.** Render the real composer in idle, active, Host-unavailable, queue-full, rejected and dispatching states. Assert actual instruction previews, legal controls, distinct send/stop controls, keyboard ordering, accessible names and bounded expansion.
- **Persistence behavior.** Accept queue items, restart Host, reload renderer from snapshot plus cursor and assert identities, order, frozen actions and attachment metadata are unchanged. Assert terminal/cancelled cards do not resurrect.
- **Interrupted-run safety.** Restart during an active effectful run. Assert it becomes interrupted under the existing replay-safe policy and queued future work remains queued until an authorized recovery/settlement boundary.
- **Plain-browser degradation.** Exercise the feature with no Electron bridge. Assert the UI feature-detects Host methods, retains a bounded honest compatibility behavior and never displays Host-accepted or true-steer claims it cannot prove.
- **Good-test rule.** Tests assert externally visible action semantics, Host protocol results, Task run identities, ordering, lifecycle boundaries and rendered controls. Private arrays, internal helper calls, CSS class names and source-text copies are not primary acceptance evidence; narrow drift guards may protect one-ingress and no-dual-authority invariants.
- **Prior art.** Reuse the shipped Pi Host orchestration/steer queue black-box smokes, Task run coordinator admission smokes, Host restart UI Projection tests, run recovery tests and rendered composer smoke patterns. New coverage must run through the repository's actual `npm run smoke` gate.
- **Qualification gate.** Resolution requires the focused follow-up suite, `npm run build`, `npx oxlint src`, full `npm run smoke`, and the relevant packaged/after-build smoke when Electron bridge or Host protocol artifacts change.

## Out of Scope

- Copying or reverse-engineering the closed-source Codex Desktop frontend implementation or visual assets.
- Changing Pi Core's model provider protocol beyond the bounded follow-up contract needed to call its existing steer capability.
- Giving External CLI runners a fabricated in-turn steer capability.
- Redesigning the full conversation timeline, run-status rail, approval modal, terminal panel or Settings information architecture.
- Replacing the Task run coordinator, unique finalization sequence, Outbound Data Gate, Turn Record or global concurrency registry.
- Automatically replaying interrupted effectful work without a Replay-safe Checkpoint.
- Treating model preambles, assistant progress prose, tool summaries or transcript parsing as queue authority.
- Supporting arbitrary cross-conversation queue reordering or moving a pending item from one Pi Session to another.
- Adding collaborative multi-user queue editing or remote synchronization outside the existing Host state model.
- Showing chain-of-thought, raw hidden reasoning, protected attachment bodies, connector tokens or internal instruction snapshots on cards.

## Further Notes

- The public `openai/codex` repository exposes the app-server/core/TUI behavior that distinguishes `turn/steer`, pending steers and queued user messages, but not the Codex Desktop frontend shown in the reference image. The card presentation is therefore a product-specific implementation informed by the observable contract, not a claim of source-level UI parity.
- OpenAI model preambles are assistant-authored progress messages before tool calls. They are distinct from user-authored pending follow-ups and must not become the source of queue state.
- The highest-value correction is semantic: route Builtin Pi steer into the already existing Host steer capability and consolidate canonical ownership before adding polished cards. Building cards first would preserve the current false steer behavior and expose two conflicting queues more visibly.
- Existing documentation that defines busy `steer` as abort-and-replace will need to be reconciled. The user-facing operation may remain available, but under the separate「中止並接手」name so that `steer` consistently means same-turn input.
