# Replace the SubAgents runtime with vendored Pi Core

Status: 可交給代理

## Problem Statement

SubAgents AI currently owns overlapping implementations for model providers, agent execution, sessions, settings, tool schemas and execution, progressive capabilities, resource discovery, compaction, and several execution paths. This makes the runtime difficult to reason about, creates duplicate sources of truth, and forces every new feature to integrate with multiple lifecycle and persistence systems.

The user wants Pi's four packages to become the project-owned foundation while keeping the Electron/React desktop product. Pi must not be treated as an external CLI. Existing SubAgents behavior that Pi already supplies should be removed after behavioral parity is proven, while differentiated behavior such as four Loop Patterns, policy, progressive capabilities, long-term memory, automation, multi-agent delegation, integrations, and Marketplace becomes Extension Packs over Pi Core.

## Solution

Vendor a pinned, project-owned fork of `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-tui` through a Git subtree. Run Pi Core, AgentSessionRuntime, tools, sessions, and Trusted Extensions in a dedicated Electron utility process called Pi Core Host. The Electron/React renderer remains the product interface and communicates through a versioned, typed Pi Host Protocol; Pi CLI and the plain browser runtime are not product entry points.

Make Pi Settings, Pi sessions, the Pi tool loop, and Pi resource discovery the only runtime owners for their respective concerns. Render explicit typed settings in the existing desktop experience and compile an immutable Effective Agent Profile for every main agent and subagent when a Task run is submitted or queued.

Organize behavior absent from Pi into cohesive Extension Packs. Preserve the four Loop Patterns through an Orchestration Extension, use independent Child Pi Sessions for subagents, retain a single Policy Extension for model activity, preserve progressive disclosure through a Capability Extension, isolate model-generated CodeMode programs, and durably journal queued and automated work. Replace legacy functionality incrementally through removable compatibility seams, proving parity before deletion and ending with a single production runtime.

## User Stories

1. As a SubAgents desktop user, I want the familiar Electron interface to remain, so that the runtime replacement does not force me into a terminal UI.
2. As a SubAgents desktop user, I want Pi Core to run locally behind the desktop app, so that I receive Pi's agent capabilities without managing a separate CLI process.
3. As a SubAgents desktop user, I want conversations to survive application and Host restarts, so that runtime isolation does not lose my work.
4. As a SubAgents desktop user, I want streamed messages, tools, approvals, file changes, and diagnostics to remain visible, so that I can understand what the agent is doing.
5. As a SubAgents desktop user, I want to cancel or steer active work, so that moving Pi into a utility process does not reduce interactive control.
6. As a SubAgents desktop user, I want Host failures to leave the desktop window usable, so that a broken extension or agent runtime does not crash the entire product.
7. As a SubAgents desktop user, I want explicit settings controls, so that I never need to edit JSON or know Pi's internal setting keys.
8. As a SubAgents desktop user, I want model, provider, thinking, tool, compaction, and session settings to configure Pi directly, so that the UI and runtime cannot disagree.
9. As an existing user, I want compatible settings and credentials migrated once, so that upgrading does not require reconfiguring every provider.
10. As an existing user, I want legacy settings removed only after successful migration, so that a partial migration cannot destroy working configuration.
11. As a user changing settings between turns, I want the next submitted Task run to use the latest saved settings, so that changes have a predictable effect.
12. As a user with queued work, I want queued runs to retain the settings selected when they were submitted, so that waiting does not silently change execution behavior.
13. As a user assigning agent roles, I want each role to choose its own model, thinking level, prompt, tools, capabilities, and Approval Mode, so that specialized agents behave as configured.
14. As a user changing settings during a run, I want the active run to keep its immutable profile, so that results remain reproducible.
15. As a user, I want Pi's canonical coding tools to replace identical legacy tools, so that the model sees one unambiguous tool for each action.
16. As a user, I want legacy tools removed only after their full behavior is proven equivalent, so that migration does not silently lose cancellation, streaming, scope, or error semantics.
17. As a user, I want product-specific tools to remain available as Pi extension tools, so that unique SubAgents workflows survive the core replacement.
18. As a user with many installed tools, I want progressive capability loading to remain, so that the model is not overwhelmed by every schema on every turn.
19. As a user, I want capability runbooks and active tools to be revealed together, so that agents receive the instructions needed to use newly available tools.
20. As a user, I want isolated CodeMode orchestration to remain available, so that agents can efficiently batch safe tool calls without receiving arbitrary host access.
21. As a user, I want every nested CodeMode tool call to remain visible and cancellable, so that batching does not hide agent actions.
22. As a user, I want one Approval Decision for model actions, so that Pi and SubAgents policies do not produce conflicting prompts or verdicts.
23. As a user, I want outbound-provider policy to continue protecting model requests, so that replacing the runtime does not bypass configured data rules.
24. As a user installing an extension, I want the UI to state that Pi extensions are fully trusted local code, so that I understand the authority I am granting.
25. As a Pi extension author, I want an unmodified Pi extension to load in SubAgents, so that I do not need to target a proprietary runtime fork.
26. As a SubAgents extension author, I want to add optional desktop settings and React surfaces, so that an extension can integrate naturally with the Electron product.
27. As an extension author, I want typed settings registration with validation and product copy, so that users receive consistent controls.
28. As an extension author, I want Pi Core behavior to remain canonical, so that I do not need to duplicate existing Pi tools or settings.
29. As a Marketplace user, I want installed packages to use Pi-compatible resource discovery, so that package behavior matches the upstream ecosystem.
30. As an MCP user, I want MCP integrations delivered as native Pi extensions, so that there is only one extension and resource lifecycle.
31. As a user with skills and prompts, I want Pi to discover and reload them through one resource system, so that duplicate names and precedence rules cannot conflict.
32. As a user, I want Turn-based, Goal-based, Time-based, and Proactive behavior to remain, so that Pi turns do not erase SubAgents product semantics.
33. As a Goal-based user, I want one Task run to coordinate multiple Pi turns until DoD or a terminal condition, so that iterative work remains coherent.
34. As an automation user, I want scheduled and proactive execution to require typed trigger evidence, so that chat wording alone cannot silently create automation.
35. As a user delegating work, I want each subagent to receive an independent Child Pi Session, so that its transcript, tools, role, and compaction do not pollute the parent.
36. As a user delegating work, I want the child to receive only an explicit Context Packet, so that parent conversation noise and protected context are not copied wholesale.
37. As a user delegating work, I want the parent to receive a result summary and inspectable child activity, so that delegation remains understandable.
38. As a user, I want long-term memory, learning, dream consolidation, and cross-session recall to remain, so that Pi session ownership does not remove differentiated memory features.
39. As a user, I want Pi alone to own transcript history and compaction, so that long-term memory cannot create a competing session history.
40. As a user working across conversations, I want different Pi sessions to run concurrently within a configured capacity, so that independent work can progress in parallel.
41. As a user working inside one conversation, I want Task runs serialized, so that concurrent work cannot corrupt one session's history, tools, or compaction state.
42. As a user submitting work while capacity is full, I want it durably queued, so that closing or restarting the app does not lose accepted work.
43. As an automation source, I want each submission to receive a durable `runId` and final settlement, so that retries can be deduplicated and audited.
44. As an automation source, I want an explicit `queue_full` failure when capacity is exhausted, so that work is never silently evicted.
45. As a user recovering from a Host crash, I want queued work restored automatically, so that interruption does not discard work that never started.
46. As a user recovering from a Host crash, I want active effectful work retried only when replay safety is proven, so that recovery cannot duplicate external side effects.
47. As a developer, I want the renderer to reconstruct state from a Host snapshot and event cursor, so that Zustand and localStorage cannot overwrite canonical runtime state.
48. As a developer, I want a versioned Pi Host Protocol with generated types, so that renderer, main, Host, and tests share one contract.
49. As a developer, I want protocol capability negotiation, so that desktop and Host version differences fail clearly or degrade intentionally.
50. As a developer, I want one black-box protocol test seam, so that settings, sessions, turns, tools, events, persistence, and recovery are verified at their highest stable boundary.
51. As a developer, I want Pi core changes recorded in a Core Patch Ledger, so that the fork remains understandable and synchronizable.
52. As a maintainer, I want each release pinned to one reviewed Pi commit, so that builds are reproducible.
53. As a maintainer, I want upstream changes to arrive through gated synchronization PRs, so that Pi updates cannot silently break product contracts.
54. As a maintainer, I want the migration to proceed behind removable seams, so that each vertical slice can be verified and rolled back independently.
55. As a maintainer, I want each migration slice to delete the behavior it replaces, so that temporary dual paths do not become permanent architecture.
56. As a release engineer, I want the final product to be Electron-only, so that packaging and testing do not maintain a second browser runtime or security model.
57. As a release engineer, I want utility-process lifecycle, migrations, recovery, and packaging qualification in release gates, so that development success also holds in packaged builds.
58. As a product owner, I want existing optional external CLI providers retained only as integrations, so that excluding Pi CLI does not unnecessarily remove distinct provider choices.
59. As a product owner, I want a single runtime owner for settings, sessions, tools, resources, and Task run ingress, so that the migration measurably simplifies the product.
60. As a future implementer, I want every ticket to be independently demonstrable through the Pi Host Protocol, so that agents can complete the migration safely in fresh context windows.

## Implementation Decisions

- Pi Core consists of a project-owned, pinned Git-subtree fork of all four Pi packages.
- Pi CLI and the interactive TUI application are excluded as product entry points; `pi-tui` remains available to terminal-oriented extensions and compatibility surfaces.
- Electron/React remains the sole product interface. The target runtime is Electron-only and does not retain the plain browser or simulation path.
- Pi Core runs in a dedicated Electron utility process supervised by Electron main.
- Electron main owns Host lifecycle, health checks, secrets, packaging integration, and narrowly scoped OS capability bridges.
- The renderer is a client of a versioned, capability-negotiated Pi Host Protocol and never imports Pi runtime classes or parses terminal output.
- Protocol schemas are generated once and cover initialization, health, sessions, Task runs, Pi turns, items, approvals, settings, extension lifecycle, steering, cancellation, snapshots, cursors, settlements, and diagnostics.
- Pi session storage and the Host run journal are canonical. Renderer state is a disposable UI Projection reconstructed from Host snapshots and events.
- Pi Settings are the runtime source of truth. The Settings Registry maps explicit Electron controls to Pi settings or Extension Pack namespaces.
- Settings precedence is Pi defaults, then role profile, then Task run override. The Effective Agent Profile is immutable from submission or enqueue through settlement.
- Legacy settings use a versioned, validate-before-delete migration. Only product settings absent from Pi remain outside Pi Settings.
- Pi owns providers, model streaming, agent turns, sessions, transcript history, compaction, tool execution, coding tools, resource loading, packages, and the native Extension API.
- A legacy tool is deleted only after an Equivalent Tool contract proves schema, result, error, streaming, cancellation, project-scope, and recording parity.
- Pi Core is the only tool loop and tool-definition owner. Product tools register through Pi extensions.
- Progressive disclosure remains in one Capability Extension using Pi's catalog and active-tool APIs; no legacy registry or executor remains after cutover.
- CodeMode remains an isolated model-generated-program environment that can call active Pi tools but has no direct Node, filesystem, process, or network authority.
- Standard Pi extensions load without runtime wrappers. Optional Desktop Contributions provide typed settings and React/Electron surfaces.
- Pi extensions use the upstream full-trust model. Installation and enablement are explicit trust decisions.
- One Policy Extension produces Approval Decisions and outbound-provider decisions for model activity using Pi hooks as enforcement points. Trusted Extension code is outside this model-activity boundary.
- Turn-based, Goal-based, Time-based, and Proactive remain product semantics in one Orchestration Extension; Pi executes the underlying turns and tools.
- A SubAgents thread maps to one durable parent Pi session. Each subagent uses an independent Child Pi Session with an Effective Agent Profile, Context Packet, budget, and result summary.
- Pi owns session history and compaction. A Memory Extension owns only durable memory, learning, dream consolidation, and cross-session recall.
- Skills, prompts, extensions, and packages use Pi's resource loader. MCP is supplied as a native Pi extension and Marketplace installs Pi-compatible packages.
- Different sessions may run concurrently within global capacity, while Task runs within one session are serialized.
- Automation uses a durable bounded FIFO queue. `runId` is created before admission and is the sole dedupe key. A full queue rejects new work with an explicit settlement.
- Queued work recovers after Host restart. Active work becomes interrupted and automatically retries only from a Replay-safe Checkpoint.
- Product-specific capabilities are grouped into domain Extension Packs rather than a monolith or one package per file/tool.
- Existing external CLI providers may remain only as optional Integrations extensions and do not become Pi Core execution paths.
- Core modifications follow a Minimal Core Patch Policy and must be tracked in a Core Patch Ledger.
- Upstream Pi updates use pinned commits and dedicated, fully gated synchronization changes.
- Migration is incremental and expand-contract. New and old implementations may coexist only in explicit, time-bounded compatibility seams that name their deletion gate.

## Testing Decisions

- The primary test seam is the Pi Host Protocol against a real Electron utility process. Tests behave as clients and assert observable requests, streamed events, settlements, persisted state, and recovery rather than inspecting internal classes or source text.
- A canonical black-box story initializes the Host, validates and updates settings, creates or resumes a session, submits a Task run, observes message/tool/approval items, receives settlement, restarts the Host, restores from snapshot/event cursor, and resumes the session.
- Protocol schema and capability-negotiation tests verify clear behavior for supported, unsupported, and mismatched versions.
- Settings tests cover typed validation, one-time migration, validate-before-delete behavior, role/task precedence, enqueue-time snapshots, session-runtime rebuilds, and secret non-disclosure to the renderer.
- Session tests cover start, resume, fork, archive, compaction, model change at run boundaries, renderer reload, Host restart, and canonical-state restoration.
- Equivalent Tool tests are behavioral contract suites run against both implementations during migration. Source names and internal call graphs are not parity evidence.
- Capability tests observe tool visibility and runbook disclosure through Pi's actual tool loop, including cross-turn and cross-run active-tool behavior.
- CodeMode tests prove direct host APIs are unavailable, nested tool calls are visible, cancellation propagates, and only active tools may be called.
- Policy tests assert composed allow, deny, ask, timeout, unattended settlement, and provider-egress decisions through Host events.
- Extension tests load an unmodified Pi extension, validate full-trust disclosure, exercise optional Desktop Contributions, and verify deterministic discovery/reload.
- Orchestration tests run all four Loop Patterns through the same protocol seam and assert trigger evidence, DoD, replan, settlement, and per-session serialization.
- Delegation tests assert Child Pi Session isolation, role-specific Effective Agent Profiles, bounded context, cancellation, inspectable activity, and parent result collection.
- Memory tests prove durable recall without duplicating Pi history or compaction.
- Automation tests cover FIFO ordering, dedupe, queue-full rejection, trigger claims, once-job settlement, restart recovery, and Replay-safe Checkpoint decisions.
- UI tests are limited to renderer projection, explicit settings controls, approval interaction, extension surfaces, and essential user journeys; they do not replace protocol behavior tests.
- Packaging smoke tests verify the utility process, vendored packages, native modules, resources, restart behavior, and Electron-only launch in packaged artifacts.
- Existing smoke scripts provide prior art for task coordination, loop parity, tool invocation, approval, outbound policy, context, security, paid workflows, and release qualification. Their assertions should move toward protocol-observable behavior as each seam migrates.
- Final qualification includes Pi upstream tests, protocol contracts, migrated smoke coverage, TypeScript build, lint, Electron integration, crash recovery, update migration, and packaging.

## Out of Scope

- Adopting Pi CLI or Pi's interactive TUI as the primary product interface.
- Keeping the Vite browser runtime, browser simulation, or a browser-compatible second Pi backend after cutover.
- Sandboxing or permission-limiting Trusted Extensions beyond Pi's full-trust execution model.
- Granting model-generated CodeMode programs Trusted Extension authority.
- Maintaining two permanent settings stores, session stores, tool loops, tool registries, resource loaders, or Task run ingress paths.
- Preserving duplicate tool names or aliases after behavioral equivalence is proven.
- Copying the entire parent transcript into every subagent.
- Running concurrent Task runs against one Pi session.
- Automatically replaying interrupted effectful work without replay-safety proof.
- Automatically following a moving Pi upstream branch.
- Rewriting the React desktop interface in `pi-tui`.
- Implementing the migration as one Big Bang change or maintaining a separate Pi-based product edition.

## Further Notes

- The architectural source of truth is the confirmed Pi Core Migration Architecture dated 2026-07-22, the project glossary, and ADR-0023 through ADR-0046.
- Upstream analysis used Pi `v0.81.1` at commit `dd6bea41efa8caa7a10fe5a6401676dc5699f83f`; implementation must revalidate the pinned source before vendoring.
- Pi explicitly treats extensions as trusted code and does not provide a general process/filesystem/network sandbox. Product copy and tests must not imply otherwise.
- The existing repository remains authoritative until an incremental migration slice passes its gate and deletes the superseded path.
- Ticket implementation should work the dependency frontier one ready ticket at a time and use the Pi Host Protocol as the default demonstration seam.
