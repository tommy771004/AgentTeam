# Verified Working Memory Lifecycle

Status: 可交給代理

## Problem Statement

SubAgents AI 已經有 Host-owned Pi Core tool loop、不可由模型製造的 Execution evidence、可稽核的 Turn Record、compaction checkpoint、Skills 與固定任務 evaluation harness，但長任務的「目前真正完成了什麼」仍主要存在於 transcript、模型敘述與壓縮時的文字推導中。

對使用者而言，這會造成四種無法可靠區分的失敗：Agent 忘記尚未完成的 goal；在錯誤時機載入或完全沒載入需要的 Skill；把 tool success 或子 Agent 的完成宣稱誤當成整體目標完成；以及從失敗 trace 產生廣泛而不可驗證的「學習」，卻不知道問題其實位於 Working State、Skill、invocation policy 或 Checker 哪一層。

現有 Compaction Manifest 只在 context rewrite 時從 transcript 以文字規則推導 objective、constraints、pending work 與 errors。它不是每一步都更新的 verified goal ledger，因此 compaction、resume、renderer reload、並行子 Agent 或長時間 Goal-based run 都可能依賴過期或未經證據驗證的狀態。現有自訂 Definition of Done 也可能因非空 assistant output 而判定成功，無法證明使用者要求的環境結果真的成立。

Skill 載入主要依初始 objective 或由模型從 catalog 自行選擇，沒有在 state-changing tool call 即將執行時，依 pending goals、constraints、blocker 與 tool draft 做一次 Host-controlled preflight。跨任務 learning 也缺少 component-level diagnosis、不可變 candidate lineage 與 held-out regression gate。

這不是新增另一套聊天記憶或另一個向量資料庫的問題。需要的是一個由 Pi Core Host 持有、以環境證據提交狀態的 Memory control layer，讓每個 Task run 都沿著同一條可稽核控制迴路運作：verified Working State → Skill invocation → tool execution → Checker → next Working State。

本 effort 必須與正在進行的「長期記憶 JSON → SQLite 遷移」保持明確邊界。該 effort 獨自擁有 DurableMemoryStore、SQLite schema、scope/policy、migration/cutover、memory CRUD、export/import、Dream transaction 與 Learning/Settings UI Projection。本 effort 不修改或平行實作上述能力，只消費其完成後的 versioned Host memory protocol 與 revision/digest contract。

## Solution

在 Pi Core Host 的 canonical Task run lifecycle 中建立 Verified Working Memory control layer。每個 builtin run 取得一份 Host-owned、具 revision 的 Working State，包含 objective、constraints、goals、status、blocker、assignment 與 Host-verifiable evidence references。只有 Checker 能以 trusted Host result、Execution evidence 與明確 completion predicate 提交 goal 狀態；模型、tool arguments、assistant text 與子 Agent 回覆都只能提出 state proposal，不能直接把 goal 標為 done。

對 state-changing tool call 增加事件式 Skill preflight。Host 在工具真正執行前，以 tool identity、pending goal IDs、constraints、blocker 與 Working State revision 查詢 invocation policy，最多選出必要且 bounded 的 Skill package。需要補充 Skill 時，原 draft 不執行，Host 記錄 synthetic not-executed outcome，將精確 Skill revision 注入下一次模型請求，再由模型重新起草。相同 preflight 使用 deterministic idempotency identity，且一批並行呼叫只要包含 state-changing action，就先完成整批 preflight，避免 sibling call 越過攔截點產生副作用。

Turn Record 升級為能表達 Working State、skill invocation、state proposal、state check 與 Memory-Control Package provenance 的唯一 timeline。Compaction Manifest 改由已提交的 Working State 投影產生；resume、renderer reload 與 replay 都從 Host snapshot 加 Turn Record events 還原同一狀態，不另建第二條 lifecycle 或 renderer authority。

跨任務改善使用版本化 Memory-Control Package 表達 Experiential Skills、Working Memory specification、invocation policy 與 Checkers。診斷只允許產生 schema-valid、component-local candidate patch；未被診斷的 component digest 必須不變。Candidate 必須修復來源失敗並通過 held-out regression gate，量測 task success、false-done、required-action recall、invocation precision/reach 與 tokens per success，才可由 Host 原子啟用；失敗 candidate 保留 lineage 但不影響 active package，且可一鍵回滾。

實作按風險分階段交付：先完成 Verified Working State 與 Turn Record trace，再加入 state-grounded Skill Invocation，接著建立版本化 package 與 validation gate，最後才允許 Meta-Agent 自動產生 candidate。任何階段都不得把 renderer 的 removable compatibility loop seam 升格為 production owner，也不得繞過 `taskRunCoordinator.runTask`、Pi Core Host tool gate 或 ADR-0048 Execution evidence。

## User Stories

1. As a user running a long Goal-based task, I want the Agent to retain the exact unfinished goals across many steps, so that important work is not lost in conversation volume.
2. As a user whose context is compacted, I want the same verified task state after compaction, so that the Agent does not regress to a transcript-derived guess.
3. As a user resuming an interrupted run, I want completed effects and pending goals restored without replaying completed side effects, so that recovery is safe and useful.
4. As a user reopening the app, I want the renderer to show the Host's current task state, so that a reload cannot replace newer truth with stale local state.
5. As a user, I want each goal to be visibly pending, done, or blocked, so that the Agent's progress has precise meaning.
6. As a user, I want blocked goals to retain a concrete blocker, so that a later continuation knows what must change.
7. As a user, I want constraints to survive every iteration and context rewrite, so that later tool calls remain within my original instructions.
8. As a user, I want a goal marked done only when its completion predicate is supported by trusted evidence, so that confident prose cannot create a false completion.
9. As a user, I want a successful shell command to prove only what that command actually established, so that exit code zero is not mistaken for completion of the whole task.
10. As a user requesting a file change, I want the goal completed only after the required write and verification evidence exist, so that an intended edit and an observed edit are distinct.
11. As a user requesting an external side effect, I want completion to require adapter-issued Execution evidence, so that the model cannot manufacture delivery or deployment success.
12. As a user, I want denied, cancelled, failed, interrupted, or not-executed tool calls to leave their goals incomplete, so that failure is never normalized into success.
13. As a user, I want an Agent to load a relevant Skill immediately before a risky state-changing action, so that instructions arrive when they can still change the action.
14. As a user, I want irrelevant Skills excluded from the model request, so that context remains focused and token cost stays bounded.
15. As a user, I want the Agent to redraft a blocked tool call after receiving the selected Skill, so that the original unsafe or incomplete draft never executes.
16. As a user, I want read-only calls to avoid unnecessary preflight overhead unless their contract explicitly requires it, so that ordinary inspection remains responsive.
17. As a user, I want parallel tool calls handled as one preflight batch when any sibling can change state, so that one call cannot mutate the environment while another is being intercepted.
18. As a user, I want repeated preflight requests to be idempotent, so that retries do not cause duplicate execution or repeated context injection.
19. As a user, I want the Agent to explain when a tool draft was not executed because a Skill preflight intervened, so that the pause is not mistaken for a tool failure.
20. As a user reviewing a past run, I want to see which Working State revision existed before and after an action, so that progress can be audited.
21. As a user reviewing a past run, I want to know which Skill id, version and digest influenced a tool call, so that behavior is reproducible.
22. As a user reviewing a past run, I want Checker verdicts tied to exact evidence references, so that a done status can be independently inspected.
23. As a privacy-conscious user, I want trace entries to carry bounded identity and revision metadata rather than copying private durable-memory bodies, so that auditability respects deletion and storage ownership.
24. As a user delegating work, I want each child Agent to receive only its assigned goal snapshot, so that delegation does not leak unrelated mutable state.
25. As a user delegating work, I want a child Agent's “完成” message treated as an observation until the parent Host validates its evidence, so that delegation cannot bypass completion checks.
26. As a user running parallel delegates, I want stale state updates rejected or rebased through revision checks, so that one child cannot overwrite another child's verified progress.
27. As a user, I want Manager-owned goals to remain ordered and isolated within their Task run, so that concurrent conversation threads do not share mutable Working State.
28. As a maintainer, I want one Host authority for Working State, so that renderer, Manager, child sessions and compaction cannot become competing ledgers.
29. As a maintainer, I want Working State updates expressed as proposals plus Checker commits, so that trust boundaries are explicit in the type system and at runtime.
30. As a maintainer, I want every state transition appended to the existing Turn Record, so that live and replay projections cannot disagree.
31. As a maintainer, I want Compaction Manifest generated from committed Working State, so that transcript regex is no longer a second state derivation authority.
32. As a maintainer, I want backward-compatible reading of older Turn Record versions, so that existing sessions remain inspectable after the format upgrade.
33. As a maintainer, I want unsupported future Turn Record versions refused loudly, so that unknown state is never treated as empty.
34. As a maintainer, I want completion predicates associated with goal kinds rather than arbitrary assistant prose, so that Checker behavior is deterministic and testable.
35. As a maintainer, I want unknown or malformed evidence to fail closed, so that a schema or adapter mistake cannot create false-done state.
36. As a maintainer, I want invocation policy to use current pending goals and tool draft context, so that it can correct a missed Skill after the initial objective changes.
37. As a maintainer, I want a bounded top-one Skill default and explicit expansion rules, so that invocation does not recreate an always-loaded Skill library.
38. As a maintainer, I want Skill packages referenced by immutable version and digest, so that an audited run does not silently point at rewritten instructions.
39. As a maintainer, I want a Memory-Control Package candidate to modify only the diagnosed component, so that a Checker defect cannot trigger unrelated Skill rewrites.
40. As a maintainer, I want unchanged components to retain identical digests, so that component-local evolution is mechanically verifiable.
41. As a maintainer, I want candidate packages separated from the active package, so that generated changes cannot affect production before qualification.
42. As a maintainer, I want a failed candidate retained with its diagnosis and results, so that failures are learnable without becoming active behavior.
43. As a maintainer, I want activation and rollback to be atomic, so that every new run sees one coherent package revision.
44. As a maintainer, I want held-out anchor tasks to remain green before activation, so that fixing one failure does not erase existing capability.
45. As a maintainer, I want evaluation to measure false-done separately from task success, so that fluent but unverified completion is penalized.
46. As a maintainer, I want required-action recall measured across long trajectories, so that Working State quality is not reduced to final answer quality.
47. As a maintainer, I want Skill invocation precision, reach and prompt-token cost measured, so that loading more context cannot masquerade as improvement.
48. As a maintainer, I want production and evaluation to use the same Task run ingress and Host lifecycle, so that the gate tests shipped behavior rather than a replica.
49. As a maintainer, I want External CLI runs to report their reduced capability matrix honestly, so that they do not claim verified Working State or Checker guarantees they do not execute.
50. As a maintainer, I want the feature to degrade safely in the plain-browser compatibility path, so that absence of the Pi Host never creates a second production authority.
51. As a maintainer working beside the durable-memory migration, I want this effort to consume only its public protocol after cutover, so that both efforts can proceed without editing the same storage owners.
52. As a maintainer working beside the durable-memory migration, I want package metadata and task Working State kept out of the durable-memory SQLite schema until an explicit integration contract exists, so that this effort cannot silently broaden the other effort's data model.

## Implementation Decisions

- **Canonical authority.** Pi Core Host owns one Working State per Task run. The state is not a renderer Zustand authority, a Pi session transcript, a Compaction Manifest, a child-session summary, or an `agent/loop/` state object.
- **Ingress and lifecycle.** Every stateful run still enters through the Task run coordinator. Working State creation, binding and final settlement occur behind that ingress; UI code never dispatches execution directly.
- **Working State contract.** The first schema version contains run identity, monotonic revision, objective, constraints and ordered goals. Each goal has stable identity, description, `pending | done | blocked` status, bounded evidence references, optional blocker and optional assigned child session identity.
- **Evidence reference contract.** A reference identifies the Host-recorded sequence and, where applicable, tool, call identity, immutable tool contract identity and adapter receipt digest. It contains no credential or unbounded raw output.
- **Proposal versus commit.** Model output, tool arguments and delegate responses may produce a typed State Proposal. Only the Host Checker may accept, reject or narrow it into the next committed Working State. Runtime validation repeats type-level guarantees and fails closed.
- **Optimistic concurrency.** Every proposal names its base revision. A stale proposal cannot overwrite newer state; the Host rejects it or deterministically rebases still-applicable evidence against current goals. Last-writer-wins is forbidden.
- **Goal completion.** A goal-specific Checker evaluates before state, proposed patch, tool call, trusted Host result and Execution evidence. Tool success is an observation, not an automatic goal completion. Unknown goal kinds remain pending unless an explicit predicate exists.
- **Checker placement.** Checkers execute inside the Host after tool settlement and before the Working State commit. They reuse the existing tool contract and Execution evidence boundary rather than introducing a renderer or model-side verifier.
- **Skill preflight trigger.** The initial trigger is a drafted state-changing tool call. The classification comes from the frozen Host tool contract and policy metadata, not a regex over a model-selected tool name.
- **Preflight batch semantics.** If a model step drafts parallel siblings and any sibling is state-changing, no sibling executes until preflight decisions for the full batch are complete. This preserves ordering and prevents partial side effects.
- **Invocation key.** Skill retrieval uses the current Working State revision, pending goal identities, blockers, constraints, immutable tool identity and bounded draft characteristics. It does not search the entire transcript by default.
- **Bounded injection.** The default result is zero or one Skill. A second Skill requires an explicit policy reason and a hard context budget. The full Skill library is never injected continuously.
- **Not-executed redraft.** When preflight adds Skill context, the original tool draft receives a Host-authored `not-executed` outcome and cannot be retried as the same execution. The next model request receives the selected immutable Skill revision and must produce a fresh call.
- **Idempotency.** Preflight and redraft identities bind run, step, batch, original call and Working State revision. A transport retry reproduces the same non-execution decision without executing the original draft.
- **Turn Record v3.** Add first-class Host-accountable entries for committed Working State, Skill invocation, State Proposal, State Check and Memory-Control Package identity. Existing message, reasoning, tool, approval, evidence, compaction and durable-memory provenance entries remain the single ordered record.
- **Record privacy.** Working State and trace entries are bounded. Sensitive long-term memory bodies remain solely in their owning durable authority; the record keeps exact identity, scope, entry revision and store revision references as required by ADR-0049.
- **Projection.** Live UI, replay, archive, compaction and resume use the same Turn Record projection. Activity events remain transport/fallback only and cannot become a parallel Pi timeline.
- **Compaction.** Compaction Manifest becomes a deterministic projection of the last committed Working State plus existing context/effect references. Transcript heuristics remain only as a legacy-reader fallback for sessions without Working State entries and cannot update canonical state.
- **Resume.** A checkpoint records the Working State revision it captured. Resume claims the existing replay-safe checkpoint, restores that revision and refuses a mismatched or missing state rather than guessing.
- **Multi-agent ownership.** Manager/parent Host owns the run-wide ledger. Child sessions receive immutable, goal-scoped snapshots and return observations plus evidence references. Parent Checkers alone commit parent goals.
- **Runner capability matrix.** Builtin Pi declares verified Working State, Skill preflight and Checker capabilities once implemented. External CLI remains `executionKind: external` and advertises none of these until an equivalent explicit runner contract exists; CLI process success is never Definition of Done met.
- **Memory-Control Package.** A package revision binds four independently digestible components: Experiential Skills, Working Memory specification, invocation policy and Checkers. Revisions are immutable and form parent-linked candidate, active or rejected lineage.
- **Package storage boundary.** This spec defines package behavior and identity, not a new SQLite schema. Until the durable-memory migration publishes an integration contract, package metadata uses an isolated Host-owned repository or existing immutable resource mechanism and accesses durable memory only through its public protocol.
- **Component-local evolution.** Diagnosis classifies a failure as Skill content, Working State schema/update, invocation policy or Checker. Candidate generation is limited to schema-valid JSON Patch against the diagnosed component; unchanged component digests must match the parent exactly.
- **Promotion.** Candidate creation never changes the active package. Activation occurs atomically only after source-failure replay and held-out regression qualification pass. Rejection records bounded results and reason. Rollback atomically selects a previously active revision.
- **Evaluation metrics.** Qualification records task success, false-done rate, required-action recall, Skill invocation precision, Skill invocation reach, prompt tokens and tokens per successful task. A score that improves only by injecting more Skill context is insufficient.
- **Delivery sequence.** Phase 1 is Verified Working State, Checker commits, Turn Record v3, compaction and resume projection. Phase 2 adds tool-call Skill preflight. Phase 3 adds immutable package lineage. Phase 4 expands the evaluation harness into a promotion gate. Phase 5 enables Meta-Agent candidate generation, disabled by default until phases 1–4 qualify.
- **Durable-memory migration boundary.** This effort does not modify DurableMemoryStore, SQLite adapters or schema, memory CRUD/scope/policy, JSON migration/cutover, corruption recovery, import/export, Dream consolidation, hard delete, Learning/Settings projection or memory protocol ownership. Integration work touching those surfaces is blocked on the owning effort's relevant resolved ticket and must use its public versioned contract.
- **ADR alignment.** Pi continues to own sessions and compaction while a Host extension owns cross-session memory. The Turn Record remains the only model-visible timeline. Model claims remain non-evidence. No production behavior moves into the removable browser compatibility seam.
- **Architecture decision threshold.** A new ADR is required before changing the location of Working State authority, allowing a model or child Agent to commit goal completion, adding a second timeline, or placing Memory-Control Package canonical state inside the durable-memory database. The staged design itself extends existing accepted decisions without overriding them.

## Testing Decisions

- **Primary seam: real Pi Core Host Task run lifecycle.** One high-level gated smoke drives a builtin Task run through the public Host protocol and canonical coordinator, using controlled model/tool fixtures. It observes Working State snapshots, tool execution/non-execution, Turn Record pages, compaction/resume and final settlement. It does not import private reducer helpers to recreate production behavior.
- **Good-test rule.** Tests assert externally observable contracts: which tool actually executed, which Host evidence was issued, which goal state committed, which record entries were published, what survived restart, and whether a candidate became active. They do not assert internal call counts, private SQL rows, regex implementation, or object layout beyond versioned public contracts.
- **Working State scenarios.** Cover initial state, monotonic revisions, pending/done/blocked transitions, malformed proposals, stale revision races, unknown goal predicates, denied/failed/cancelled tools, false completion claims and evidence bound to the wrong run, action or call.
- **Checker scenarios.** Use real Host tool-result envelopes and Execution evidence fixtures. Prove that assistant prose, model arguments, exit code alone and delegate claims cannot complete goals, while the correct trusted receipt plus goal predicate can.
- **Skill preflight scenarios.** Prove zero-match pass-through, top-one injection, bounded expansion, original-call non-execution, redraft execution, retry idempotency and batch-wide blocking when one parallel sibling is state-changing.
- **Turn Record scenarios.** Prove v3 ordering, source accountability, immutable package/Skill identities, proposal-to-check-to-state sequence, bounded metadata and identical live versus replay projection. Retain backward-reader fixtures for v1/v2 and fail-closed fixtures for unsupported future versions.
- **Compaction and recovery scenarios.** Force compaction during a multi-goal run, restart the Host, claim a replay-safe checkpoint and verify objective, constraints, goal states, blockers and completed effect identities remain identical without repeating side effects.
- **Multi-agent scenarios.** Run two child sessions against the same parent revision. Prove child snapshots are goal-scoped, direct parent-state mutation is impossible, correct evidence can be committed by the parent Checker and stale competing updates are rejected or rebased without data loss.
- **Package scenarios.** Prove immutable revision/digest identity, component-local JSON Patch, unchanged-component digest preservation, candidate isolation, atomic activation, rejected-candidate non-effect and rollback.
- **Evaluation gate scenarios.** Maintain a source-failure corpus plus held-out successful anchor tasks. Qualification fails on any false-done regression, required-action recall regression, unbounded token increase, missed required Skill or unjustified Skill invocation even when aggregate task score rises.
- **Runner parity scenarios.** Prove builtin Pi advertises and executes the new lifecycle while External CLI continues to disclose its reduced capability matrix and cannot report Checker-backed Definition of Done.
- **Plain-browser scenarios.** Prove the compatibility path presents a clear degraded capability state and does not create a renderer-owned Working State or claim Host verification.
- **Conflict-isolation scenario.** Run the new lifecycle against the public in-memory implementation of the durable-memory protocol. The test must not import, migrate, inspect or mutate the production SQLite adapter, ensuring this effort can develop while the durable-memory migration session owns that surface.
- **Prior art.** Follow the existing real Host protocol smokes for process lifecycle and restart, Turn Record fidelity/live-timeline smokes for ordered projection, compaction/recovery smokes for checkpoint behavior, side-effect evidence smokes for fail-closed trust, skill/Host contract smokes for immutable tool and resource identity, delegation smokes for child sessions, and the fixed-task evaluation smoke for the promotion gate.
- **Gate requirement.** Every new smoke must be included in the actual `npm run smoke` chain before its ticket may be resolved. A test file that exists but is absent from the gate is not completion evidence.

## Out of Scope

- Replacing or redesigning the DurableMemoryStore, its SQLite schema, adapters, ranking, scope enforcement, quotas, migration markers or storage lifecycle.
- JSON-to-SQLite migration, dual-authority cutover, WAL/corruption handling, downgrade policy or legacy memory cleanup.
- Durable-memory CRUD tools, explicit remember semantics, automatic learning settlement, Dream consolidation, hard delete, canonical memory export/import or Learning/Settings UI Projection owned by the durable-memory migration effort.
- Copying private durable-memory bodies into Working State or the Turn Record.
- Replacing Pi Core session persistence, transcript history or compaction ownership.
- Adding imports or production lifecycle behavior to the removable renderer compatibility loop seam.
- Changing the one-ingress Task run coordinator, same-thread ordering, cross-thread concurrency or automation trigger evidence rules.
- Treating External CLI as capability-equivalent to the builtin Pi runner without a separately specified contract.
- General-purpose vector search, embedding infrastructure or continuous injection of the entire Skill catalog.
- Allowing Meta-Agent output to edit arbitrary TypeScript, application settings, durable-memory rows or active packages directly.
- Automatically activating candidates before the validation gate, or activating a candidate solely because the source failure passed.
- Designing a new Working State editor UI. Initial UI work is limited to projection and audit of Host-owned state.
- Retrofitting every historical session with invented verified goal state; older sessions remain readable through explicitly labeled legacy projection.

## Further Notes

- The design is based on the Recuris control loop, but adopts AgentTeam's domain boundaries: Task run, Pi Core tool loop, Execution evidence, Turn Record, UI Projection, Trusted Extension and Approval Decision.
- The first implementation PR should be Phase 1 only: Verified Working State plus Checker-backed state commits, Turn Record v3 and compaction/resume projection. It must not begin Meta-Agent evolution or durable-memory integration.
- The deterministic reducer proposed for large child/tool observations may sit before Checker evaluation, but it must preserve original run, goal, call, receipt and Turn Record references. Raw evidence remains in the Turn Record or its owning Host authority.
- The durable-memory SQLite migration is an explicit parallel effort and dependency, not a subtask here. Any future decision to persist Memory-Control Packages in that database requires coordination after its cutover and a separately accepted contract or ADR.
- Success means the Harness can answer, from Host-owned records alone: what remained to be done, which Skill was selected and why, what tool actually happened, which evidence justified the state transition, and which package revision governed the run.
