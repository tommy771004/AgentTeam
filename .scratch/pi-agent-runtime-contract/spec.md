# Pi Agent Runtime Tool Contract

Status: 可交給代理

## Problem Statement

使用者目前看到的工具目錄、模型在 Pi turn 裡實際取得的 schema、direct protocol 可接受的參數、Code Mode 可呼叫的工具，以及 Approval Decision、Outbound Data Gate、Restricted Project View 和 Turn Record 所證明的行為，仍由數個不同位置各自投影或推導。系統已經把 production tool loop 與大部分工具 ownership 搬到 Pi Core Host，但 Host 還不能對外描述「這一個 turn 真正交給模型的完整工具 contract」。

這使 parity qualification 只能用舊 renderer schema 加上行為測試近似證明 required parameters，無法證明完整 input schema。跨舊工具與 Pi builtin 的 rename、default materialization 和 semantic translation 也容易被誤寫成完全相同。相同問題延伸到 MCP：Host 能列出 MCP 工具，模型卻主要經由通用的 MCP bridge 呼叫，沒有完整利用每個 MCP 工具自己的 schema 與 Pi 的 Dynamic Tool Loading。

builtin `bash` 的安全責任也分成兩層。Direct `tools/*` 只會對明確的 `params.path` 做 project containment，而 shell command 沒有單一路徑。真正的 ADR-0047 約束位於 Pi Core Host 的 in-turn shell gate，但現有 smoke 主要證明 policy function、IPC wiring 與 source ownership，還沒有透過一個真實 Pi turn 證明 Outbound Guard `required` 下的 command 確實沒有執行。`required` 目前也只能 fail closed，因為 builtin shell 尚無經 main-side probe 驗證的 sandbox backend。

結果是 Pi Agent 已經擁有正確的 production owner，卻還不是一個自我描述、每回合凍結、可端到端驗證的工具平台。維護者難以回答某次 run 中模型到底看見哪個 schema，使用者也無法確信 UI、模型、Code Mode、MCP 與安全證據描述的是同一套能力。

## Solution

在 Pi Core Host 建立 Host-owned、per-turn immutable 的 Turn Tool Contract。它從該 Pi session 真正完成載入後的 builtin tools、Extension Packs、MCP tools、capability activation 與 availability facts 產生，成為模型工具 schema、Host catalog projection、Dynamic Tool Loading、Code Mode、direct protocol validation、UI Projection 與 Turn Record 的共同來源。

`tools/list` 保持精簡，只提供 catalog、active state、availability 與 schema digest。新增按需的 contract description protocol，讓測試、UI 或診斷只查詢需要的 active tool schema，不把所有 deferred 或 MCP schema 一次灌入 context。`tool_search` 與 capability load 也從同一份 Turn Tool Contract 派生，確保被找到、被啟用、被模型看見與可被執行是同一件事。

所有 invocation origin，包括真實 Pi tool call、direct protocol、Code Mode nested call、Extension Pack 與 MCP，使用同一個 Host-owned policy and evidence module，產生一致的 Approval Decision、Outbound Data Gate verdict、Restricted Project View binding、audit events 與 settlement。Pi Core 繼續擁有 tool loop 與 builtin execution，不新增第二個 executor switch。

舊 renderer 工具只保留為 qualification fixture 中的 translation contract，顯式記錄 rename、default materialization 與 semantic translation，不再充當 production catalog。Qualification 從出貨的 Pi Host Protocol over stdio 啟動真實 Pi turn，證明模型收到的 schema digest、實際 invocation、policy decision、result 與 Turn Record 完整對應。

MCP 工具在對應 capability 載入後，以 namespaced、帶真實 input schema 的 Pi native dynamic tools 暴露給模型，並仍走既有 Host MCP client 與同一套 Approval Decision、Outbound Data Gate 和 execution evidence。

builtin shell 分兩階段完成。第一階段補上 `required` 模式的真實 Pi turn denial qualification。第二階段另以新 ADR 定義並實作 main-side verified sandbox adapter，在 macOS 與 Linux 通過 backend probe 和 canary 後才簽發 metadata-only isolation evidence；沒有合格 backend 的平台維持 fail closed。這讓嚴格模式最終可以安全使用 Pi builtin shell，而不是降低 ADR-0047 的保證。

## User Stories

1. As a SubAgents user, I want the tools shown in Settings to be the tools the Pi Agent can actually call in this turn, so that the UI never advertises unavailable capability.
2. As a SubAgents user, I want a disabled or unavailable tool to carry its own readable reason, so that a reduced catalog is visible rather than silent.
3. As a SubAgents user, I want loading a capability to make its tools callable in the same turn, so that the agent can adapt without restarting.
4. As a SubAgents user, I want a previously loaded capability to be restored for the next turn in the same conversation, so that the agent does not repeatedly rediscover the same tools.
5. As a SubAgents user, I want deferred capabilities to consume only a concise catalog entry until needed, so that unrelated schemas do not waste context budget.
6. As a SubAgents user, I want tool discovery, activation and execution to agree, so that a tool found by `tool_search` is not refused by a different inventory.
7. As a SubAgents user, I want Pi Agent to use each enabled MCP tool through its real parameter schema, so that tool selection and argument construction are more reliable.
8. As a SubAgents user, I want MCP tools to remain namespaced by their installed source, so that tools with the same upstream name cannot collide.
9. As a SubAgents user, I want an MCP server reload to take effect on the next turn without changing an in-flight turn, so that execution remains deterministic.
10. As a SubAgents user, I want Code Mode to call exactly the tools active in the surrounding turn, so that it is neither unexpectedly weaker nor a policy bypass.
11. As a SubAgents user, I want direct tool calls and model-originated tool calls to receive the same validation outcome, so that behavior does not depend on the entry path.
12. As a SubAgents user, I want expected tool failures to return structured content, so that Pi Agent can recover within the turn instead of losing the whole run.
13. As a SubAgents user, I want large streaming results to remain bounded and recoverable, so that one tool cannot exhaust the turn record or renderer.
14. As a SubAgents user, I want cancellation to settle every active tool call exactly once, so that a cancelled run cannot later report success.
15. As a SubAgents user, I want file-mutating tools to share the per-file mutation queue, so that concurrent changes to one path cannot interleave or overwrite each other unpredictably.
16. As a SubAgents user, I want Restricted Project View protection to apply to Extension Packs and MCP tools as well as builtins, so that adding a tool does not create a new escape path.
17. As a SubAgents user, I want Outbound Data Gate protection to apply to every invocation origin, so that Code Mode or MCP cannot become an egress bypass.
18. As a SubAgents user, I want Approval Mode to mean the same thing for builtin, Extension Pack, Code Mode and MCP calls, so that authority is predictable.
19. As a SubAgents user, I want capability-required approval and restrictive hooks to survive `完整存取權`, so that the composed Approval Decision keeps its existing order and meaning.
20. As a SubAgents user, I want unattended runs to preserve their automatic downgrade and timeout behavior, so that background execution cannot wait forever or auto-approve an ask.
21. As a strict-mode user, I want builtin `bash` refused when verified filesystem isolation is absent, so that Outbound Guard `required` never claims a protection the runtime cannot prove.
22. As a strict-mode user on a supported platform, I want builtin `bash` to run inside a verified sandbox once a trusted backend passes its probe, so that I can use full Pi Agent shell capability without weakening protection.
23. As a Windows strict-mode user, I want builtin `bash` to remain explicitly unavailable when no verified backend exists, so that the product fails closed rather than silently degrading.
24. As a SubAgents user, I want optional shell mode to report degraded protection honestly, so that lexical command checks are not presented as filesystem isolation.
25. As a SubAgents user, I want every denied shell call to appear as an outbound-shell decision in the Turn Record, so that I can understand why no command ran.
26. As a SubAgents developer, I want one immutable Turn Tool Contract per Pi turn, so that mutable settings or server reloads cannot change the schema during execution.
27. As a SubAgents developer, I want the Turn Tool Contract to be captured from the tools Pi actually exposes to the model, so that it cannot drift from a hand-maintained catalog.
28. As a SubAgents developer, I want every tool contract to carry a stable schema digest, so that model context, invocation validation and recorded evidence can be correlated without duplicating large schemas.
29. As a SubAgents developer, I want Turn Record tool entries to store the contract digest and invocation origin, so that a historical run can be audited against the exact capability the model saw.
30. As a SubAgents developer, I want `tools/list` to remain a lightweight catalog projection, so that Settings and diagnostics do not force eager schema disclosure.
31. As a SubAgents developer, I want an on-demand contract description method, so that qualification can compare complete runtime schemas without adding a second registry.
32. As a SubAgents developer, I want `tool_search`, capability load and model tool registration to derive from the same snapshot, so that there is one active-tool formula.
33. As a SubAgents developer, I want direct protocol validation to use the current Host contract, so that hand-written parameter checks cannot drift from Pi's model-facing schema.
34. As a SubAgents developer, I want one policy and evidence module for every invocation origin, so that approval, outbound protection and audit fixes have locality.
35. As a SubAgents developer, I want Pi Core to remain the sole production tool loop and builtin executor, so that runtime unification does not recreate the legacy renderer engine.
36. As a SubAgents developer, I want legacy tool differences represented as explicit translation fixtures, so that rename and default materialization are documented instead of normalized away.
37. As a SubAgents developer, I want the legacy `workspace_grep` contract to record `query` to `pattern` and the materialized default path separately, so that parity claims remain precise.
38. As a SubAgents developer, I want obsolete renderer definitions removed from production authority after qualification, so that there is no second live catalog.
39. As a SubAgents developer, I want MCP input schemas captured from the enabled server and frozen per turn, so that upstream changes cannot mutate an in-flight run.
40. As a SubAgents developer, I want MCP dynamic tools to reuse the existing Host MCP client, so that native Pi registration does not create a second transport implementation.
41. As a SubAgents developer, I want an MCP tool call to carry the same runId, callId and parentRunId coordinates as other tools, so that Turn Record fidelity is preserved.
42. As a SubAgents developer, I want sandbox isolation evidence issued only by the trusted main-side probe, so that renderer or model data cannot manufacture proof.
43. As a SubAgents developer, I want sandbox evidence bound to backend, profile digest, view root and run, so that evidence cannot be replayed across unrelated executions.
44. As a SubAgents developer, I want a failed sandbox canary to deny builtin shell before execution, so that backend presence alone is never treated as verification.
45. As a SubAgents developer, I want protocol additions to follow Pi Host Protocol version negotiation, so that older renderer and Host versions fail clearly rather than misreading payloads.
46. As a SubAgents developer, I want the plain-browser compatibility seam to degrade explicitly when Host contract inspection is unavailable, so that browser mode remains usable without pretending to have Electron capabilities.
47. As a SubAgents developer, I want qualification to drive the shipped Pi Host over stdio, so that green tests prove the production path rather than an in-process reimplementation.
48. As a SubAgents developer, I want qualification to run a real Pi turn with a deterministic provider fixture, so that a tool that is merely listed but never model-callable cannot pass.
49. As a SubAgents developer, I want one contract matrix covering builtin, Extension Pack, deferred, MCP and Code Mode calls, so that parity is demonstrated consistently across tool classes.
50. As a SubAgents developer, I want source-text drift guards replaced by externally observable qualification wherever possible, so that internal refactoring does not invalidate behavioral tests.
51. As a SubAgents developer, I want catalog generation to fail closed when the Host cannot produce the turn contract, so that renderer fallback cannot recreate the two-catalog split.
52. As a SubAgents maintainer, I want the accepted builtin-shell ADR to point at the current Host owner, so that future sandbox work changes the real execution seam.

## Implementation Decisions

- The Pi Core Host owns a Turn Tool Contract module. One immutable snapshot is created per Pi turn after resource and extension loading and before model execution begins.
- The Turn Tool Contract is captured from the tools the Pi session actually exposes, not rebuilt from renderer definitions. It includes tool name, description, complete input schema, source, owning Extension Pack or capability, active state, availability reason and schema digest.
- The snapshot is bound to the session and run coordinates. Changes to Settings, MCP servers, installed extensions or capability persistence do not mutate an in-flight snapshot.
- `tools/list` remains the single lightweight catalog projection. It exposes source, pack, active state, availability, reason and schema digest, but does not eagerly include every full schema.
- A versioned on-demand Host protocol method describes complete tool contracts for requested names. It only returns contracts visible under the requesting session's current activation state and reports inactive or unavailable tools explicitly.
- The protocol addition follows existing Pi Host Protocol version negotiation. An incompatible renderer or Host receives an explicit capability/version error rather than a partial response.
- `tool_search`, capability catalog presentation, capability activation, Pi active-tool controls, Code Mode availability and UI Projection all derive from the same Turn Tool Contract module.
- Loading a deferred capability updates the active set through Pi's native active-tool mechanism and produces a new session contract revision for subsequent tool calls in that turn. The revision and schema digests remain recorded so earlier calls keep their original coordinates.
- Full schemas are canonicalized before hashing. Digests are stable across object key ordering and change whenever model-visible validation semantics change.
- Direct Host protocol calls validate arguments against the same contract revision used for model-facing registration. Hand-written validation may remain only for protocol envelope fields such as cwd, runId and callId.
- Pi Core remains the sole production tool loop and builtin executor. The feature does not add a central executor switch or move Node-only Pi runtime code into the renderer.
- A Host-owned policy and evidence module evaluates all invocation origins. Its interface accepts invocation coordinates, tool contract identity, arguments, run policy and origin, then returns allow, ask or deny plus normalized arguments and evidence requirements.
- The existing Approval Decision evaluation order remains authoritative. Deny rules and restrictive hooks win, capability-required approval cannot be bypassed by Approval Mode, and unattended runs retain their downgrade and timeout behavior.
- Outbound Data Gate and Restricted Project View posture are frozen at task-run admission and carried to the Host with the turn context. Invocation paths do not re-derive a weaker policy from mutable Settings.
- Turn Record tool-call and tool-result entries carry schema digest, contract revision, tool source and invocation origin in addition to existing coordinates and settlement.
- Expected tool failures remain structured result content and do not throw through the Pi turn. Protocol/runtime failures that prevent trustworthy execution remain explicit failed settlements.
- Streaming output stays bounded and cancellation settles exactly once. File-mutating tools continue to use the shared per-file mutation queue.
- Legacy renderer equivalence is represented by static qualification fixtures, not a live production registry. Each fixture records name translation, parameter rename, default materialization and semantic translation separately.
- The legacy grep fixture records `query` to `pattern` as a rename and the default project-relative path as materialization. A same-name parameter is never described as a rename.
- MCP tools are discovered through the existing Host MCP client. Their current descriptions and input schemas are frozen into the turn contract.
- Enabled MCP tools receive deterministic namespaced Pi tool names. Name collision resolution is stable and visible in the catalog.
- MCP tools remain deferred by default when their schemas would otherwise consume unnecessary context. Loading the owning capability registers or activates their real schemas through Pi's native tool controls.
- The generic MCP bridge remains only as a compatibility or discovery adapter until native dynamic registration has passed qualification. It is then removed or hidden from model invocation so there is one preferred execution contract.
- The first builtin-shell milestone preserves ADR-0047 and adds real-turn proof that `required` denies when filesystem isolation is not verified.
- Enabling builtin shell under `required` requires a new accepted ADR. The ADR must define supported backends, profile construction, backend probing, canary semantics, view mounting, network posture, evidence lifecycle and platform refusal behavior.
- Sandbox verification executes in a trusted main-side adapter. Renderer state, model text and tool arguments cannot set or synthesize `shellIsolationVerified`.
- Verified shell evidence is metadata-only and bound to run, backend, profile digest and Restricted Project View. A missing, malformed, stale or failed-canary evidence object causes denial.
- macOS and Linux may become supported through verified Seatbelt and bubblewrap adapters respectively. Windows remains fail closed until an equivalent backend is designed and qualified.
- Optional shell mode may retain degraded command/path inspection, but product copy and evidence must not describe lexical checks as filesystem isolation.
- The UI remains a UI Projection. It reads Host catalog and contract descriptions and never writes canonical tool definitions back to the Host.
- Plain-browser compatibility feature-detects the Host methods. It may expose its existing reduced compatibility behavior, but it does not fabricate a Pi Host contract.
- Existing accepted ADRs remain in force. This work deepens ADR-0027, ADR-0028, ADR-0038, ADR-0047 and ADR-0048; the verified builtin-shell backend is the only part requiring a new architectural decision before implementation.

## Testing Decisions

- The primary test seam is the shipped Pi Host Protocol over stdio. Tests spawn the built Electron Host artifact with isolated state and workspace fixtures, then observe protocol responses, events and durable Turn Record entries.
- Tests assert externally observable behavior only: catalog entries, described contracts, actual Pi tool calls, decisions, streamed updates, results, settlement and record coordinates. They do not assert private registry shape or internal function call arguments.
- Model-facing qualification starts a real Pi turn using a deterministic provider fixture that emits known tool calls. A listed tool that never becomes callable by the Pi model must fail qualification.
- A contract qualification compares the schema digest described through the Host protocol with the digest recorded on the actual model-originated tool call and its result.
- The qualification matrix includes at least one Pi builtin, one always-active Extension Pack tool, one deferred capability tool, one MCP tool, one mutating file tool and one Code Mode nested invocation.
- Schema tests cover complete model-visible contracts, including property names, types, required fields, defaults, enums, bounds and nested shapes. Required-field behavior alone is not labeled full schema parity.
- Legacy parity tests translate fixture calls into Host calls and verify success, structured failure, default materialization and semantic result equivalence. Differences are asserted explicitly rather than normalized away.
- Capability tests observe catalog and contract changes before and after load in the same session, then verify the next turn restores persisted capability preferences without mutating the previous turn contract.
- MCP tests use a controlled MCP fixture server. They verify discovery, namespacing, schema capture, deferred activation, real Pi invocation, structured failure and server schema changes between turns.
- Code Mode tests prove nested calls use the surrounding active set and cannot inherit approval from the outer `run_code` invocation.
- Approval tests cover `要求核准`, `代我核准`, `完整存取權`, capability-required approval, restrictive hook denial and unattended downgrade through actual Host events.
- Outbound and Restricted Project View tests cover builtin, Extension Pack, MCP and Code Mode origins through the same observable decision and settlement shapes.
- Builtin-shell qualification creates a real Pi turn under Outbound Guard `required`, triggers a bash call and proves no command side effect occurred, the decision is deny, the result settles denied and matching outbound-shell evidence appears in the Turn Record.
- Sandbox adapter tests run main-side backend probes and canaries. A passing backend must demonstrate both allowed in-view access and refused out-of-view access; absence, malformed evidence or canary failure must deny execution.
- Platform qualification expects explicit refusal on unsupported platforms. It never changes `required` into degraded execution to make a cross-platform test pass.
- Streaming tests verify byte bounds and spill/retrieval behavior. Cancellation tests verify one terminal settlement and no late success.
- Mutation tests issue concurrent same-path operations through production invocation paths and verify serialization through final filesystem state and Turn Record order.
- Protocol compatibility tests cover supported version negotiation, unsupported description methods, missing contract revisions and stale schema digests.
- Catalog failure tests verify the renderer reports Host catalog unavailability and does not fall back to renderer definitions.
- Plain-browser tests verify feature detection and explicit degraded behavior without importing or pretending to own the Electron Pi runtime.
- Prior art includes the existing Pi Host capabilities spawn-and-drive smoke, equivalent-tool project-scope smoke, outbound shell evidence smoke, record-fidelity qualification and MCP fixture tests. New tests replace overlapping source-text assertions once their externally observable equivalents are green.
- Effort completion requires one top-level qualification command that exercises the full contract matrix against shipped modules. Build and packaging remain gated on that qualification through the existing smoke chain.

## Out of Scope

- Replacing Pi Core's production tool loop, session runtime or builtin implementations.
- Restoring renderer-side production tool registration, schema authority or capability execution.
- Preserving legacy tool names as permanent runtime aliases.
- Adding new product-specific Extension Packs or business workflows unrelated to runtime contract fidelity.
- Redesigning the Settings or conversation UI beyond the changes needed to project Host-owned facts and errors.
- Eagerly placing every active, deferred and MCP schema into `tools/list` or the model context.
- Building or redesigning the Marketplace installation experience.
- Changing the external CLI sandbox contract established by ADR-0022.
- Treating lexical shell command inspection as verified filesystem isolation.
- Providing a successful Windows builtin-shell sandbox before a separate supported backend and ADR exist; explicit refusal remains correct behavior.
- Letting renderer code, model output or tool arguments issue execution or isolation evidence.
- Undocumented modification of vendored Pi internals. Any required upstream change must follow the Core Patch Ledger and upstream sync policy.
- Expanding Protected Data classification policy beyond applying the existing Outbound Data Gate consistently to all tool origins.
- Guaranteeing cross-turn stability for an MCP server that changes its schema without reload; stability is guaranteed within the frozen turn contract.

## Further Notes

- The central design goal is locality: one Host-owned Turn Tool Contract module hides discovery, activation, schema capture, hashing and projection behind a small interface. Deleting it should force that complexity to reappear across model registration, catalog, Code Mode, MCP, UI and tests; that is the leverage expected of a deep module.
- The contract snapshot is a statement about one Pi turn, not a new global registry. Per-turn immutability is what makes historical evidence meaningful and prevents mutable Settings or upstream MCP changes from altering an active run.
- `tools/list` and the on-demand description method serve different needs. The former is a compact catalog projection; the latter is the qualification and diagnostics surface for complete contracts. Keeping them separate preserves Dynamic Tool Loading and context efficiency.
- The current omission of a direct-protocol bash path-scope assertion remains intentional. Shell containment is proven at the in-turn ADR-0047 seam and, once available, by the verified sandbox adapter. Adding a synthetic `params.path` to bash would create a misleading guarantee.
- The accepted ADR-0047 documentation should be updated to name the current Host-side owner before implementation begins. The change is documentation alignment, not a relaxation of the decision.
- Completion means the answer to “what could Pi Agent call, under which schema and authority, in this run?” can be reconstructed from the Host contract and Turn Record alone, without consulting renderer state or source code.
