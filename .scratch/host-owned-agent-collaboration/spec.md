# Host-owned Agent Collaboration Lifecycle

> 狀態：`resolved（2026-08-30；本機 qualification 完成；signed/notarized publication 仍需外部 Apple credentials）`

## Problem Statement

使用者可以從對話中的 Task run 委派 Child Pi Session，但目前的能力主要停在「建立 child、排入背景 queue、稍後查詢或採用 goal evidence」。主 agent 無法在 child 執行途中可靠補充資訊，child 也缺少 durable mailbox 主動回報發現、阻塞與衝突；兄弟 agent 更沒有可定址的協作通道。一般 child 完成後不一定會把結果自動送回 durable parent，而現有狀態查詢也沒有完整呈現 queued、running、blocked、terminal、adopted 的生命週期。

這使 Sub Agent 更像背景 job，而不是能在同一對話工作樹中互相搭配的智慧體。當兩個 child 對同一份 workspace 有重疊寫入、需求互相矛盾、其中一方需要另一方的新 contract，或 parent 在執行途中改變方向時，系統缺少一套 Host-owned、可恢復、可稽核的溝通與仲裁流程。現行 renderer delegation seam 另有 persona、worktree、batch 等能力，但 production Pi Host delegation 並未完全對齊，形成兩套語意與生命週期漂移。

使用者需要的不是把所有 child transcript 混進主對話，也不是讓模型自行宣稱已協調完成；而是一套以 Pi Core Host 為唯一權威、以 Turn Record 為唯一時間軸、能傳訊、喚醒、等待、中止、回報與驗證採用結果的完整 Agent Collaboration lifecycle。

## Solution

在 Pi Core Host 建立一個 versioned、Host-owned 的 **Agent Communication Domain**。每個主 agent 與 Child Pi Session 都保有獨立 session、Context Packet、Effective Agent Profile、Turn Record 與 lifecycle state，同一棵 agent tree 則共用可定址的 tree identity、durable mailbox、執行容量與 rollout budget。

對模型提供一組語意清楚的 collaboration commands：spawn、send、follow-up、interrupt、wait、list 與 adopt。一般 message 只排進 mailbox，不會憑空啟動新 turn；follow-up 可在 agent idle 時啟動新 turn，running 時則在安全訊息邊界交付；interrupt 採 safe park，不切斷正在產生 execution evidence 的 effect。child 的 terminal result 以 one-hop 規則自動送回 direct parent，寫成結構化 Turn Record entry 並喚醒等待中的 parent。多層 delegation 由每一層 parent 負責整合與向上 relay，不讓孫節點結果神祕地跨層注入 root。

workspace 衝突由 Host 在 side effect admission 前處理。每個 write-capable child 必須有明確 execution workspace mode 與 project-relative write scope；重疊 lease 會 fail closed，並向衝突雙方與共同 parent 發出結構化 conflict event。需要同時修改相同範圍的工作使用 isolated worktree，隔離建立失敗時不得靜默回退成共享寫入。模型可以討論與提出解法，但只有 Host 能授予、移轉或釋放 write authority。

child final text 只是一份 observation。父層要把 delegated goal 標為完成，仍必須經過現有 Host Checker，確認 execution evidence、base revision 與 completion predicate 仍然適用。renderer 只從 Host snapshot 加 cursor events 重建 UI Projection；collaboration activity 綁定到產生它的 Chat turn，完成後留在歷史中，不得漂移到下一輪對話的執行區。

## User Stories

1. As a conversation user, I want the main agent to delegate a bounded objective to an independent child agent, so that complex work can be split without mixing multiple roles into one transcript.
2. As a conversation user, I want each child agent to show its role, task name and current status, so that I know who is doing what.
3. As a conversation user, I want child activity grouped under the Chat turn that spawned it, so that the next turn does not inherit stale progress UI.
4. As a conversation user, I want to expand a child activity row to inspect its messages, tool activity and settlement, so that the compact conversation remains understandable without hiding evidence.
5. As a conversation user, I want completed child work to remain visible in conversation history, so that I can audit earlier collaboration by scrolling back.
6. As a conversation user, I want the parent agent to receive a child completion automatically, so that completed background work is not silently lost.
7. As a conversation user, I want an explicit distinction between child completion and parent adoption, so that a returned answer is not misrepresented as verified work.
8. As a conversation user, I want the parent to continue useful work while children run, so that delegation reduces wall-clock time instead of only adding waiting overhead.
9. As a conversation user, I want the parent to wait efficiently when a child result is on the critical path, so that the app does not repeatedly poll and consume model turns.
10. As a conversation user, I want to send a correction to a running child, so that I can resolve a misunderstanding without discarding all of its work.
11. As a conversation user, I want follow-up work to reuse an idle child's existing context, so that related work does not require a new child every time.
12. As a conversation user, I want to interrupt a child that is pursuing the wrong direction, so that it stops at a safe boundary without orphaning an in-flight effect.
13. As a conversation user, I want cancelling the root task to have a visible and deterministic policy for descendants, so that background agents do not continue unexpectedly.
14. As a conversation user, I want an agent waiting for approval to be shown as waiting rather than running, so that I understand why no progress is occurring.
15. As a conversation user, I want child failures, timeouts and cancellations reported as distinct terminal states, so that recovery actions match the actual failure.
16. As a parent agent, I want to send a mailbox message without starting a new child turn, so that I can share information without causing unnecessary execution.
17. As a parent agent, I want to send a follow-up task that starts an idle child or reaches a running child at a safe boundary, so that task control has predictable semantics.
18. As a parent agent, I want to list every visible descendant with canonical identity and lifecycle state, so that I can coordinate a nested agent tree.
19. As a parent agent, I want to wait on mailbox activity rather than repeatedly querying status, so that completion delivery is event-driven.
20. As a parent agent, I want child final responses delivered exactly one hop, so that nested orchestration ownership is explicit and duplicate result delivery cannot occur.
21. As a nested parent agent, I want to integrate my direct children's results before reporting upward, so that the root receives one coherent result rather than unstructured descendant noise.
22. As a child agent, I want to message another visible agent in the same tree, so that I can share a discovered API contract or warn about a dependency conflict.
23. As a child agent, I want my parent to be notified when I become blocked, so that the parent can reassign work or provide missing authority.
24. As a child agent, I want my mailbox messages delivered at deterministic boundaries while I am sampling or executing a tool, so that inputs are neither lost nor injected mid-effect.
25. As a child agent, I want my Effective Agent Profile and permission limits preserved across follow-up turns, so that reuse cannot silently weaken or reset policy.
26. As a child agent, I want inherited permissions to be restrictive-only, so that delegation cannot gain more authority than its parent possessed.
27. As an orchestrator, I want depth and concurrency budgets enforced for the whole agent tree, so that recursive delegation cannot exhaust the machine or provider quota.
28. As an orchestrator, I want completed agents retained for a bounded period, so that I can send a related follow-up without unbounded memory growth.
29. As an orchestrator, I want closing or retiring a child to be explicit and idempotent, so that capacity and retained context are released predictably.
30. As an orchestrator, I want the system to reject messages addressed outside my root agent tree, so that one conversation cannot interfere with another.
31. As a developer, I want same-session Task runs serialized while different sessions may run concurrently, so that one session's history and compaction state cannot be mutated by two runs.
32. As a developer, I want every collaboration command and outcome recorded in the Turn Record, so that live UI and replay use the same ordering and meaning.
33. As a developer, I want message delivery to be durable across renderer reload, so that UI process lifetime does not define agent communication lifetime.
34. As a developer, I want Host restart recovery to mark orphaned active work honestly and retain terminal mail, so that restart does not fabricate completion or silently lose it.
35. As a developer, I want duplicate message and completion delivery deduplicated by stable identity, so that retrying transport cannot trigger duplicate turns or adoption.
36. As a developer, I want queue saturation to return an explicit bounded failure, so that an older task is never silently evicted to accept a newer one.
37. As a developer, I want delivery, consumption and acknowledgement represented separately, so that a message cannot disappear merely because it was published.
38. As a developer, I want write authority checked before a side effect begins, so that conflict handling does not depend on repairing two concurrent edits afterward.
39. As a developer, I want project-relative write scopes canonicalized by the Host, so that aliases and path traversal cannot bypass conflict detection.
40. As a developer, I want overlapping writer scopes to produce a structured conflict event, so that agents can communicate about the exact resource in conflict.
41. As a developer, I want concurrent writers to use verified isolated worktrees when their scopes cannot be proven disjoint, so that parallel work does not corrupt the shared checkout.
42. As a developer, I want isolation failure to fail closed rather than fall back to shared writes, so that the UI never promises isolation that does not exist.
43. As a developer, I want worktree results reviewed and explicitly integrated, so that isolation does not become an automatic merge authority.
44. As a developer, I want child completion observations checked against the current parent revision, so that stale evidence cannot close a goal after sibling changes invalidate it.
45. As a developer, I want sibling effects settled before delegated goal adoption, so that Checker decisions observe a stable workspace state.
46. As a developer, I want failed or unverifiable child claims preserved as observations without advancing Working State, so that failure remains inspectable.
47. As a renderer developer, I want collaboration UI rebuilt from snapshot plus cursor events, so that Zustand never becomes a second lifecycle authority.
48. As a renderer developer, I want late child completion attributed to its originating Chat turn even if that turn has already completed, so that it does not appear as current-turn progress.
49. As a renderer developer, I want active collaboration and historical collaboration projected through the same row model, so that replay cannot disagree with live presentation.
50. As a plain-browser user, I want missing Host collaboration capabilities to degrade explicitly, so that simulation never claims durable multi-agent guarantees.
51. As a security-conscious user, I want mailbox content and child context to pass through the existing Outbound Data Gate, so that collaboration does not bypass Protected Data policy.
52. As a security-conscious user, I want connector credentials to remain outside messages and renderer state, so that subagent communication does not widen credential exposure.
53. As a maintainer, I want one production delegation owner, so that renderer and Pi Host implementations cannot drift into incompatible lifecycles.
54. As a maintainer, I want external CLI delegates to advertise only the collaboration guarantees they really support, so that a spawned process is not presented as a durable conversational agent.
55. As a maintainer, I want collaboration limits, delivery rules and cancellation policy expressed as protocol contracts, so that UI copy and runtime behavior cannot diverge.

## Implementation Decisions

- **Pi Core Host is the sole production authority.** Agent tree identity, mailboxes, lifecycle state, delivery acknowledgement, execution capacity, write authority and result adoption live behind the Pi Host Protocol. Electron main is a supervisor and typed relay; renderer state is a disposable UI Projection.
- **One production delegation path.** The existing renderer/Hermes delegation path must either become a compatibility adapter into the Host-owned domain or be retired after parity is reached. It must not keep an independent production lifecycle, budget or completion mechanism.
- **Independent sessions remain mandatory.** Each child has its own Pi Session and Turn Record. Role switching inside the parent's transcript and wholesale parent-history inheritance remain rejected. A child starts from an explicit Context Packet and immutable parent/delegated-goal snapshot.
- **Canonical tree addressing.** Every spawned agent receives a stable session identity plus a human-readable canonical task path within one root tree. Relative names resolve only inside that tree. Cross-tree messaging fails closed.
- **Communication authorization is narrower than visibility.** Agents may send informational messages to visible agents in the same tree. Only the direct parent, or root acting over its descendants, may assign follow-up work, interrupt, close or change write authority. Siblings can report conflicts but cannot take control of each other.
- **Durable mailbox envelope.** Every message has a stable message id, sender and receiver identities, root tree id, originating turn/run identity, kind, creation time, bounded content, delivery mode, delivery state and acknowledgement state. Payloads never carry raw credentials or a whole transcript.
- **Two delivery modes.** `send` is queue-only and never starts a turn. `follow-up` starts a turn when the receiver is idle; while it is running, delivery occurs after the current model message or pending tool call completes. Neither mode injects content in the middle of an effect.
- **Event-driven waiting.** `wait` observes the caller's mailbox and lifecycle notifications and returns on new activity, user steer or a bounded timeout. It does not terminate children and is not implemented as repeated status polling.
- **One-hop completion routing.** A child terminal response is delivered exactly once to its direct parent's mailbox and attributed to the parent's originating turn. Grandchild results do not automatically jump to root; their parent integrates and relays them. This rule applies equally to success, failure, cancellation and interruption.
- **Lifecycle state is explicit.** Agent runtime state distinguishes queued, admitted, running, waiting-approval, blocked, completed, failed, cancelled and interrupted. Result availability, acknowledgement and adoption are separate fields rather than overloaded terminal states. State transitions are monotonic and Host-authored.
- **Safe interruption and cancellation.** Interrupt requests safe-park at the next model/tool boundary and preserve evidence from effects already started. Root cancellation cascades to descendants by default; an explicitly detached background child may complete only when its admission snapshot grants that lifecycle, and the UI must show it as detached.
- **Retention is bounded.** Active agents are retained until terminal. Terminal agents and unacknowledged mailbox results remain addressable for a bounded TTL and count cap; acknowledgement or explicit close can release them earlier. Cleanup never evicts active work merely to admit new work.
- **Same-session serialization remains unchanged.** One Pi Session admits only one active Task run. Different sessions may execute concurrently within the global and tree budgets. Follow-up messages do not create concurrent mutation of one session.
- **Restrictive policy inheritance.** Child approval, sandbox, capability, MCP, Outbound Data Gate and provider settings inherit from the admitted parent snapshot and may only become more restrictive. Follow-up turns reuse the child's effective profile unless an authorized parent supplies a valid restrictive update.
- **Explicit workspace modes.** Every child is admitted as shared-readonly, shared-leased-write or isolated-worktree. Write-capable children require canonical project-relative scopes. Concurrent unscoped writers are not admitted to the same checkout.
- **Host-owned write leases.** Before any write side effect, the Host verifies the caller owns a compatible lease at the current workspace revision. Overlap produces a structured conflict event delivered to both writers and their closest common parent; it does not optimistically write and repair later.
- **Isolation fails closed.** When worktree isolation is required, inability to create or verify it rejects or blocks the child. Silent fallback to shared workspace is forbidden. Applying isolated changes remains an explicit reviewed mutation and is not performed by the collaboration bus.
- **Conflict resolution is parent-mediated.** After a conflict, the owning parent chooses to serialize work, narrow or transfer scope, move a child to an isolated worktree, revise the task, or cancel one branch. Agents can propose this decision, but only Host commands change authority.
- **Completion text is observation, not Execution evidence.** Child final text and messages are durable observations. Delegated Working State advances only after the existing Host Checker verifies trusted evidence, completion predicate, base revision and current applicability after sibling effects settle.
- **Generic and goal-directed results both return.** Every terminal child produces a bounded result summary and result reference. Goal-directed children additionally produce delegation observation/check entries and may be adopted; generic analysis children remain informative results without mutating Working State.
- **Turn Record remains the one timeline.** Spawn, delivery, receipt, wait, conflict, interruption, terminal result, Checker decision and adoption are typed Turn Record entries. A separate activity channel may transport live events but cannot become another historical truth source.
- **Conversation attribution is immutable.** Collaboration entries retain the originating Chat turn identity even when completion arrives later. The active run surface shows only current-turn work; older activity remains accessible by scrolling or expanding its historical group.
- **The protocol is versioned and feature-detected.** Collaboration commands, snapshots and events are added through negotiated Pi Host capabilities. Older Host or plain-browser execution reports collaboration unavailable/degraded and never fabricates mailbox, isolation or Checker guarantees.
- **External CLI honesty.** An external CLI subprocess may be used as a child runner only through its explicit runner contract. Unless it has a durable session and message adapter, it receives initial/follow-up context as separate executions and must not claim live mailbox, peer messaging or verified DoD capabilities.
- **Budgets are tree-scoped.** Depth, concurrent active agents, retained terminal agents, queued messages, message bytes and rollout usage have bounded Host-enforced limits. Rejection returns a structured reason and never silently drops older work.
- **No scheduler or publishing authority expansion.** Agent collaboration does not create scheduled triggers, publish externally, merge branches, send connector messages or bypass existing approval/admission authorities.

## Testing Decisions

- **Primary seam: Pi Host Protocol.** The highest-value test exercises the complete external behavior through the versioned Host surface: spawn a child, deliver queue-only mail, trigger a follow-up turn, observe wait wake-up, create and report a conflict, interrupt, receive one-hop completion, run Checker adoption, acknowledge and close. Tests do not reach into private maps or invoke extension functions directly.
- **One canonical fixture vocabulary.** Protocol tests assert emitted snapshots, ordered Turn Record entries and public settlements. They do not assert internal call counts, class names or storage layout.
- **Deterministic lifecycle fixtures.** A fake clock and deterministic ids cover delivery/ack retry, duplicate transport, queue saturation, timeout, TTL cleanup, terminal retention, late events, safe interruption, cascade cancellation and Host restart recovery without sleep-based races.
- **Tree routing coverage.** Tests cover parent→child, child→parent, sibling informational message, root→descendant control, forbidden sibling control, forbidden cross-tree delivery, direct-child completion and grandchild one-hop completion with explicit parent relay.
- **Message-boundary coverage.** A running child receives queued mail only after a model message or tool call boundary. A follow-up sent to an idle child starts one turn; multiple follow-ups preserve FIFO and never create overlapping Task runs in one session.
- **Conflict admission coverage.** Tests use canonical project-relative paths to prove disjoint writers may proceed, overlapping writers fail before mutation, aliases cannot bypass overlap, conflict events reach both writers and parent, lease transfer is authoritative, and required worktree isolation cannot fall back to shared writes.
- **Checker coverage.** Child text without execution evidence remains unverified. Valid evidence at the assigned base revision may be adopted; stale or invalidated evidence is recorded but does not advance Working State. Sibling effects are settled before the decision.
- **Recovery coverage.** Persisted mailbox delivery, completion notification, acknowledgement, tree edges, lifecycle state and write leases are reconstructed after Host restart. Renderer reload uses snapshot plus cursor and does not redeliver or duplicate UI rows.
- **Pure UI Projection seam.** A small pure projection fixture consumes the same Turn Record entries used by live replay and asserts grouping, status labels, late completion attribution, expansion content and the absence of previous-turn activity from the next turn's active surface. No separate UI activity model is introduced.
- **Accessibility and interaction coverage.** Collaboration groups are semantic controls with keyboard expansion, visible focus, status text independent of color, and bounded narrow-layout behavior. Essential content is visible without animation.
- **Existing prior art is extended.** Reuse the current Pi Host protocol/E2E smoke shape, delegated-goal Host Checker smoke, run queue/recovery smoke, same-session serialization smoke, live timeline projection smoke and active-run reattachment smoke. Repoint drift guards to the new owner instead of weakening them.
- **Production-path qualification.** At least one real Pi Core turn must spawn a real child, exchange a follow-up message, produce a terminal result, survive renderer reload and complete verified adoption. A second scenario must demonstrate overlapping write conflict without modifying the protected file.
- **Release gates stay intact.** Build/typecheck, lint, the complete smoke chain and packaged Electron qualification remain green. New lifecycle guarantees must be on the normal smoke/release path rather than a known-ungated script.

## Out of Scope

- Scheduler trigger ownership, cron/event admission and publishing lifecycle authority.
- Automatic Git merge, conflict-marker resolution, force push or remote repository mutation.
- Cross-project, cross-root-tree, cross-device or network-distributed agent messaging.
- Exposing raw child chain-of-thought; only product-approved reasoning/activity projection and bounded summaries are shown.
- Combining all child transcripts into the parent model context or shared conversation history.
- Treating shell processes, Pi utility processes or external CLI processes as conversational agents without a real session/message adapter.
- Replacing the existing Approval Decision, Outbound Data Gate, Execution evidence, Verified Working State or Host Checker authorities.
- Unlimited agent depth, concurrency, mailbox retention or transcript retention.
- Reproducing Codex Desktop UI pixel-for-pixel; Codex is a behavioral reference, while the UI remains within AgentStudio's existing design language.
- Changing Time-based, Proactive, connector or automation execution ingress.

## Further Notes

- The design borrows Codex's useful separation between spawn, queue-only message, turn-triggering follow-up, interrupt and event-driven wait, but deliberately strengthens it with AgentStudio's Host Checker and explicit workspace authority.
- One-hop completion routing is intentional. It avoids duplicate root delivery and makes every nested orchestrator responsible for its own subtree. If product requirements later demand transitive root notifications, that change needs a separate protocol decision rather than an implicit UI shortcut.
- The current ADRs already establish independent Child Pi Sessions, typed Host protocol, Host-canonical state, durable queue/recovery and same-session serialization. If implementation needs to move execution/finalization ownership or create a second canonical timeline, stop and write a new ADR first.
- UI copy should continue using Traditional Chinese mixed with English and distinguish「子程序」from「子智慧體」. A process reports output and exit; an agent owns a session, mailbox, task and lifecycle.
- The intended product signature is an inspectable agent work tree tied to real Turn Record evidence—not decorative avatar cards or a generic chat-with-bots surface.

## Tickets

| # | Ticket | Blocked by |
|---|---|---|
| 01 | [Agent tree 與 lifecycle read model](issues/01-agent-tree-lifecycle-read-model.md) — 已完成 | — |
| 02 | [統一 Child Pi Session spawn admission](issues/02-unified-child-spawn-admission.md) — 實作完成 | 01 |
| 03 | [Durable queue-only agent mailbox](issues/03-durable-agent-mailbox.md) — 實作完成 | 02 |
| 04 | [Follow-up task 與 profile continuity](issues/04-followup-profile-continuity.md) — 實作完成 | 03 |
| 05 | [Event-driven wait 與 mailbox wake-up](issues/05-event-driven-agent-wait.md) — 實作完成 | 03 |
| 06 | [One-hop child completion delivery](issues/06-one-hop-child-completion.md) — 實作完成 | 03, 05 |
| 07 | [Safe interrupt 與 descendant cancellation](issues/07-safe-interrupt-cascade-cancellation.md) — 實作完成 | 02, 06 |
| 08 | [Agent retention、ack、close 與 recovery](issues/08-agent-retention-recovery.md) — 實作完成 | 06, 07 |
| 09 | [Host-owned write scope 與 conflict notification](issues/09-write-scope-conflict-notification.md) — 實作完成 | 02, 03 |
| 10 | [Verified worktree isolation](issues/10-verified-worktree-isolation.md) — 實作完成 | 09 |
| 11 | [Sibling-settled Checker adoption](issues/11-sibling-settled-checker-adoption.md) — 實作完成 | 06, 09, 10 |
| 12 | [對話中的 Agent Work Tree UI](issues/12-agent-work-tree-ui.md) — 實作完成 | 01, 06, 07, 09, 11 |
| 13 | [External CLI collaboration capability honesty](issues/13-external-cli-collaboration-honesty.md) — 實作完成 | 04, 06 |
| 14 | [Renderer delegation expand–contract 收口](issues/14-renderer-delegation-contract.md) — 實作完成 | 04, 07, 10, 11, 13 |
| 15 | [真實 Pi Core collaboration release qualification](issues/15-real-pi-collaboration-qualification.md) — 待最終單次驗證 | 08, 10, 11, 12, 14 |

**Frontier:** 01–14 已完成實作；15 依使用者要求只在全部修改完成後執行一次完整 smoke，失敗項目再集中修復。
