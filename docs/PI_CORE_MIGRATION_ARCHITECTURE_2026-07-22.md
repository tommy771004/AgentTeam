# Pi Core Migration Architecture

Status: **decisions confirmed; implementation not started**  
Date: 2026-07-22  
Upstream analysis baseline: [`earendil-works/pi`](https://github.com/earendil-works/pi) `v0.81.1`, commit `dd6bea41efa8caa7a10fe5a6401676dc5699f83f`

## Objective

Replace SubAgents AI's overlapping model, agent, session, tool-loop, resource, and terminal foundations with a project-owned fork of Pi's four packages while retaining the Electron/React desktop experience. Product behavior that Pi does not provide becomes cohesive Extension Packs; behaviorally equivalent legacy implementations are removed after parity is proven.

This is a core replacement, not an external CLI integration. Pi's `pi` CLI and interactive TUI application are not product entry points.

## Target topology

```text
Electron Renderer (React)
  - conversations, settings, approvals, activity, extension UI
  - disposable Zustand UI Projection
                    │
                    │ Pi Host Protocol
                    ▼
Electron Main
  - Pi Host supervision and recovery
  - secrets and OS capability bridges
  - application lifecycle and packaging
                    │
                    │ versioned requests + streamed events
                    ▼
Pi Core Host (dedicated utility process)
  ├─ Pi Settings / Settings Registry adapter
  ├─ durable Pi sessions and Host run journal
  ├─ @earendil-works/pi-coding-agent SDK/runtime
  ├─ @earendil-works/pi-agent-core
  ├─ @earendil-works/pi-ai
  ├─ @earendil-works/pi-tui
  └─ trusted Extension Packs
       ├─ Orchestration + Delegation
       ├─ Policy
       ├─ Capabilities + CodeMode
       ├─ Memory
       ├─ Automation
       ├─ Integrations
       └─ Marketplace / product workflows
```

The renderer never imports Node-only Pi runtime code and never invokes or parses Pi CLI output. The target product is Electron-only; the plain Vite browser runtime is removed at cutover.

## Pi Core ownership

| Pi package | Target ownership | Explicit exclusion | Legacy area replaced after parity |
|---|---|---|---|
| `pi-ai` | Provider/model catalog, model calls, streaming and normalized LLM messages | None of the SubAgents UI is moved here | `agent/llm.ts`, overlapping provider adapters and model normalization |
| `pi-agent-core` | Agent state, turns, tool execution and agent event stream | SubAgents Task run and four Loop Pattern semantics | Legacy function-calling tool loop and overlapping agent execution state |
| `pi-coding-agent` | SDK, AgentSessionRuntime, sessions, settings, resources, extensions and canonical coding tools | `pi` CLI entry point and interactive TUI application | Session/history/compaction, settings, resource discovery and equivalent coding tools |
| `pi-tui` | Vendored terminal primitives and compatibility for terminal-oriented extensions | It does not render the Electron application | Any duplicated terminal primitives only; React remains the product UI |

The four packages live under `vendor/pi/` as a Git subtree from a project-owned fork. Releases pin one reviewed upstream commit.

## Extension ownership

An Extension Pack owns a coherent product capability, not one file and not one tool. An existing Pi feature always wins when it is behaviorally equivalent.

| Extension Pack | Product responsibility | Representative current sources to migrate or remove |
|---|---|---|
| Orchestration | Turn/Goal/Time/Proactive patterns, DoD, replan, Task run lifecycle | `agent/loop/`, `engine.ts`, `dodEvaluator.ts`, `replan.ts`, `taskRunCoordinator.ts` |
| Delegation | Child Pi Sessions, context packets, budgets, parent result collection | `agent/hermes/delegate.ts`, background delegation paths |
| Policy | Single Approval Decision and outbound-provider policy through Pi hooks | `agent/tools/toolGuard.ts`, approval modes, hooks, outbound/security modules |
| Capabilities | Progressive runbooks, `load_capability`, `tool_search`, active-tool projection | `agent/capabilities/`, capability-owned parts of `agent/tools/` |
| CodeMode | Isolated model-generated JavaScript coordinating active Pi tools | `agent/tools/codeMode.ts` and nested invocation bridge |
| Memory | Durable memory, learning, dream consolidation and cross-session recall | non-session portions of `agent/hermes/` |
| Automation | Durable queue, scheduling, trigger evidence and once-job settlement | `scheduler.ts`, `eventMatcher.ts`, `runQueue.ts`, automation/background jobs |
| Integrations | MCP, webhook, Telegram, content publishing and optional external CLI providers | Electron bridges and connector modules not supplied by Pi |
| Marketplace | Pi-compatible package discovery, installation, entitlement and desktop contributions | Hermes plugin catalog/installer and feature-pack product surfaces |

Standard Pi extensions load without runtime wrappers. A package may optionally include a SubAgents Desktop Contribution manifest for settings controls, navigation, React panels or other Electron-only surfaces.

## Runtime identities

The protocol and journal keep these identities separate:

- **Pi session**: durable conversation history owned by Pi.
- **Task run**: one `runId`-scoped SubAgents orchestration over a session.
- **Pi turn**: one agent turn within a Task run; a Goal-based run may contain several.
- **Item**: streamed message, tool, command, file change, approval or diagnostic activity.
- **Child Pi Session**: independent subagent history, profile, tools and budget.

A SubAgents thread maps to one durable parent Pi session. Different sessions may execute concurrently within the configured global limit, but Task runs within one session are serialized. Composer steer input joins the active turn; queue creates a later Task run.

## Per-agent settings

Pi Settings are the runtime source of truth. Electron renders explicit, typed controls from the Settings Registry; users never edit JSON or internal Pi keys.

```text
Pi defaults
  → selected role profile
  → Task run overrides
  = immutable Effective Agent Profile
```

The profile contains at least model, thinking level, system/role prompt, active tools, capability preload and Approval Mode. It is captured when the Task run is submitted or queued. A later run in the same session uses the latest saved settings; an active or queued run never changes underneath execution.

Settings that require only Pi session actions apply at the next run boundary. Provider/auth/resource/extension changes may rebuild AgentSessionRuntime between runs while preserving Pi session history and rebinding extensions.

Legacy provider, model, credential and preference fields receive a versioned one-time migration. A value is deleted from the legacy store only after validation and successful Pi persistence. Only Electron product concerns absent from Pi remain outside Pi Settings.

## Tools and progressive capabilities

Pi's canonical `read`, `bash`, `edit`, `write`, `grep`, `find` and `ls` tools replace legacy names only after contract tests establish parity across:

- input schema and validation;
- successful and failed results;
- streaming updates;
- cancellation;
- project/cwd scope;
- session and audit recording.

Any missing behavior is first implemented as a Pi wrapper or separately named extension tool. Duplicate aliases are not retained.

Pi Core is the sole tool loop and source of tool definitions. The Capability Extension controls visible/active tools and reveals runbooks progressively through Pi's extension APIs. It does not retain the legacy registry/executor/tool-loop stack.

CodeMode remains available, but model-generated JavaScript runs in an isolated worker without direct Node, filesystem, process or network access. It may call only active Pi tools; every child invocation is separately observable and cancellable.

## Trust and permissions

Pi extensions follow Pi's full-trust model. Loading an extension grants it the Pi Host process's filesystem, process, environment, credential and network authority. The UI must present installation and enablement as a trust decision and must not claim extension sandboxing.

SubAgents retains one Policy Extension for model activity. Pi's tool and provider hooks are enforcement points for the existing Approval Decision and outbound-provider rules, not a second permission system. Direct Node actions performed by Trusted Extensions can bypass those model hooks by design.

Model-generated CodeMode programs remain isolated and do not inherit Trusted Extension authority.

## Host protocol

The versioned Pi Host Protocol is generated from one schema and begins with initialization plus capability negotiation. Its stable surface covers:

- host health, version and capabilities;
- session create/resume/fork/archive;
- Task run submit/steer/cancel/status;
- streamed item start/update/complete events;
- approval request/resolve/timeout;
- settings read/validate/update/reload;
- extension/package discovery and lifecycle;
- snapshot plus event-cursor recovery;
- structured diagnostics and settlements.

Protocol messages expose domain records, never Pi class instances. Electron main supervises the utility process and brokers only OS capabilities and secrets that should not be renderer-visible.

## State, queue and recovery

Pi session storage and the Host run journal are canonical. Zustand/localStorage are disposable UI Projections reconstructed from a snapshot followed by events after a cursor.

The Automation Extension persists queued work and trigger evidence. `runId` is assigned before admission and is the only dedupe identity. The bounded queue is FIFO. When full, new work receives an explicit `queue_full` settlement; existing work is not evicted or reordered.

After Host restart:

- queued runs return to the queue;
- completed/settled runs remain settled;
- an active run becomes `interrupted`;
- automatic retry occurs only from a Replay-safe Checkpoint;
- uncertain effectful work requires manual retry or returns a failed unattended settlement.

## Upstream policy

The vendored fork follows a Minimal Core Patch Policy:

1. Prefer an unmodified Pi extension.
2. Prefer a SubAgents Extension Pack or host adapter.
3. Patch Pi Core only for a required stable hook or Host API that cannot live outside core.
4. Record every core change in the Core Patch Ledger with upstream base, rationale, contract, tests and upstream disposition.

Upstream updates arrive only through dedicated sync PRs. They must pass upstream Pi tests, protocol compatibility, Equivalent Tool parity, settings/session migrations and Electron smoke tests before the pinned commit advances.

## Incremental migration

Old and new paths may coexist only behind removable migration seams. Each phase ends by deleting the superseded implementation after parity; no permanent dual runtime is allowed.

### Phase 0 — Baseline and vendor

- Add the project-owned Pi fork as `vendor/pi/` Git subtree.
- Pin the reviewed upstream commit and preserve MIT notices.
- Establish the Core Patch Ledger.
- Capture behavioral fixtures for current settings, sessions, tools, approvals, queue and four Loop Patterns.

Exit gate: Pi packages build in the Electron toolchain without changing production dispatch.

### Phase 1 — Pi Core Host and protocol

- Add the utility-process entry point and Electron main supervisor.
- Generate protocol types and implement initialize, health, diagnostics and shutdown.
- Add renderer client, snapshot/event projection and crash-restart harness.
- Run all UI development and tests through Electron; remove browser-mode expectations only at final cutover.

Exit gate: repeated Host crash/restart does not crash the window or corrupt protocol state.

### Phase 2 — Settings, providers and credentials

- Build the Settings Registry and explicit Electron controls.
- Bridge credentials through Electron main without renderer exposure.
- Implement the one-time legacy-to-Pi settings migration.
- Compile and snapshot Effective Agent Profiles.

Exit gate: every retained setting has one owner and profile fixtures prove precedence and snapshot timing.

### Phase 3 — Sessions and model turns

- Map SubAgents threads to durable Pi sessions.
- Replace model/provider streaming with `pi-ai` and `pi-agent-core` turns.
- Project Pi items into existing conversation/activity UI.
- Move history and compaction authority to Pi.

Exit gate: new, resumed, forked and compacted sessions survive application restart with no renderer-canonical state.

### Phase 4 — Canonical tools

- Add parity tests for Pi coding tools and legacy equivalents.
- Route Pi tool updates, cancellation and results through Host items.
- Migrate non-equivalent product tools as Pi extension tools.
- Delete each legacy equivalent immediately after its gate passes.

Exit gate: no duplicate tool names, schemas, handlers or invocation records remain.

### Phase 5 — Capability and Policy Extensions

- Port progressive disclosure and active-tool control to the Capability Extension.
- Port approval and outbound-provider decisions to the Policy Extension.
- Rebuild isolated CodeMode over Pi tool calls.
- Delete the legacy function-calling loop, capability runtime and duplicate schema registry.

Exit gate: tool visibility, forced approval, nested CodeMode calls and outbound decisions match fixtures through Pi's sole tool loop.

### Phase 6 — Resources, packages and memory

- Use Pi resource/package discovery for skills, prompts and extensions.
- Package MCP as a native Pi extension.
- Move durable learning and cross-session recall into the Memory Extension.
- Migrate installed resources and remove Hermes duplicate loaders, session history and compaction.

Exit gate: a single discovery result and reload path exists for every resource type.

### Phase 7 — Orchestration, delegation and automation

- Port the four Loop Patterns to the Orchestration Extension.
- Map each subagent to a Child Pi Session with an Effective Agent Profile and explicit Context Packet.
- Persist queue, trigger claims and settlements in the Automation Extension.
- Enforce cross-session concurrency, per-session serialization and replay-safe recovery.

Exit gate: composer, scheduler, webhook, Telegram and delegate all produce the same Task run protocol and settlement contract.

### Phase 8 — Extension Packs and desktop contributions

- Move remaining differentiated product capabilities into domain Extension Packs.
- Add typed settings and React contributions without wrapping Pi ExtensionAPI.
- Convert Marketplace installation to Pi-compatible packages.
- Retain optional non-Pi external CLI providers only as Integrations extensions.

Exit gate: disabling a nonessential pack removes its capability cleanly without destabilizing Pi Core.

### Phase 9 — Cutover and deletion

- Make Pi Core Host the only production runtime.
- Remove migration flags, adapters and dead legacy settings.
- Remove the browser/simulation runtime and browser-only smoke assumptions.
- Update `AGENTS.md`, commands and architecture docs to describe Electron-only development.
- Run full smoke, build, packaging, restart/recovery and update-migration suites.

Exit gate: production code has one settings owner, one session owner, one tool loop, one resource loader and one Task run ingress.

## Verification gates

Every migration PR must run checks proportional to its boundary. The final cutover requires:

- Pi upstream package tests for the pinned source;
- generated protocol schema compatibility tests;
- Electron utility-process lifecycle and crash recovery tests;
- session migration/resume/fork/compaction fixtures;
- settings migration, validation and profile-precedence fixtures;
- Equivalent Tool behavioral matrices;
- approval and outbound-policy event fixtures;
- CodeMode isolation and nested-call cancellation tests;
- parent/child session isolation and result-collection tests;
- durable queue, queue-full, dedupe and replay-safe recovery tests;
- extension/package discovery and reload tests;
- `npm run smoke`, `npm run build`, `npx oxlint src`, and packaging smoke from `app/` after the scripts are migrated.

Source-text regex assertions should be replaced by behavioral contracts as each boundary becomes executable.

## Definition of done

The migration is complete only when:

1. Electron/React remains the sole product interface and Pi CLI is not a product entry point.
2. All four vendored Pi packages are present, pinned and covered by the Core Patch Ledger.
3. Pi Core Host is the only agent runtime and can recover independently of the renderer.
4. Pi Settings, sessions, tool loop and resource loader each have no competing legacy owner.
5. Every removed tool or feature has parity evidence or an explicit product removal decision.
6. Four Loop Patterns, role-specific subagents, approvals, automation and long-term memory operate as Extension Packs over Pi Core.
7. Standard Pi extensions run unmodified; desktop contributions remain optional.
8. Trusted extension authority and CodeMode isolation are accurately represented in UI copy and tests.
9. Legacy migration seams, obsolete settings and the browser runtime are deleted.
10. Full Electron build, smoke, recovery and packaging qualification pass.
