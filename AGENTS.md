# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Repository layout
The product is **`app/`** — an Electron desktop app "SubAgents AI" (React 19 + TypeScript + Vite + zustand). Everything else at the root is design input, not code:

- `docs/01_…` / `02_…` / `03_…` `.md` — the loop spec (system definition, four loop patterns, request-parsing schema) the engine implements
- `docs/` — integration plans and audits (`TASK_AGENT_WORKFLOW_INTEGRATION_PLAN_2026-07-14.md` is the lifecycle plan; `PYDANTIC_AI_V2_CAPABILITIES.md` maps capability concepts)
- `CONTEXT.md` — product domain language
- There is **no in-repo `RTK.md`**. Agent operating guidance for this product is `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` / `docs/*` only (any host-level `@RTK.md` is unrelated tooling).

UI copy, log messages, and some comments are Traditional Chinese mixed with English — keep that style.

## Commands

All from `app/`:

```bash
npm install
npm run dev        # Vite + Electron; UI also works in plain browser at :5173
npm run build      # tsc -b && vite build (use this as the typecheck)
npm run smoke      # full smoke chain — pure logic + Electron contract (ends with npm test)
npm test           # vitest + @testing-library/react component tests (src/**/*.test.tsx)
npx oxlint src     # lint
npm run dist:mac   # smoke + build + electron-builder (also dist / dist:win / dist:all)
```

Smoke scripts cover scheduler math, event matching, capability/compaction pure logic, and the built Electron preload/main contract; UI component tests run on vitest + jsdom + Testing Library (`vitest.config.ts`, setup at `src/test/setup.ts`, devDependencies only). `dist*` refuses to package if smoke (including component tests) fails.

## Architecture

### Execution flow (default single run; optional capped concurrency)

All entry points go through **`agent/taskRunCoordinator.ts` `runTask`** (canonical ingress). Legacy `runExternal.ts` is an implementation detail behind the coordinator — new code must not call `runExternalObjective` or `dispatchThreadTask` from UI.

Pipeline:

- UI composer / slash / retry, scheduler ticks, webhook, Telegram, background delegate → **`taskRunCoordinator.runTask`** → capacity / attachments / thread bind / beforeRun (once) → **`runDispatch.dispatchThreadTask(snapshot)`** (runner select only) → builtin `agentEngine` **or** external CLI (`localCliRun`, gated by `settings.cliProviders`) → **`finalizeTaskRun`** (summary → afterRun → Archive → onSettled → release → drain).

**Concurrency** (ADR-0003): default is still single-run behavior (`concurrentRunsEnabled: false`). When opted in, a small per-app cap (`maxConcurrentRuns`, default 4, range 2–8) allows multiple `runId`s. Capacity is reserved in the coordinator; overflow uses `runQueue` (FIFO + dedupe, max 24). `agentStore.isRunning` is a derived convenience, not the sole lock — active runs live in a registry keyed by `runId`. Use `onSettled` so once-jobs still get `markJobResult` after 補跑.

**Time-based / Proactive triggers**: conversation auto-classifier only emits Turn-based / Goal-based. Cron/event wording becomes an `AutomationSuggestion`, never a direct Time/Proactive tool run. **Time-based** requires a claimed `ScheduledJob` trigger snapshot; **Proactive** requires matcher-produced event evidence (`eventMatcher.ts`). Invalid triggers fail before capacity reservation.

### Runner capability matrix (`agent/runners/`)

| Capability | Builtin (`loop`) | External CLI (`external`) |
|---|:---:|:---:|
| parse / validateDoD / iterate / continueGoal / progressiveCapabilities | yes | **no** |
| runScopedProgress (cancel / activity by `runId`) | yes | yes |

CLI success is **not** DoD met (`EXTERNAL_CLI_DOD_LABEL`). UI shows「外部 CLI 執行」and disables continueGoal until a prompt contract + fixture enable those flags.

### Engine (`agent/engine.ts`)

Implements the four loop patterns from the spec (Turn-based / Goal-based / Time-based / Proactive). Each step runs `executeStepWithAgent`, which takes one of three paths:

1. **Function-calling tool loop** (`agent/tools/toolLoop.ts`) when LLM enabled + `functionCalling` on — the main path, with full progressive disclosure
2. **Heuristic path** — keyword tool selection (`tools/registry.ts` `selectToolsForStep`) + plain LLM; still capability-aware (runbooks injected, `approvalTools` enforced, owning capabilities auto-loaded) but without model-driven progressive disclosure
3. **Simulation** when no LLM configured — all features must degrade gracefully to this

Runs from automation sources (scheduler / webhook / Telegram / delegate) set `unattended: true` — HITL asks and safety interventions auto-deny after a timeout (45s unattended, 90s interactive) instead of blocking forever.

Sub-agent roles (Manager/Analyzer-1/Writer/Core) map to `settings.roleModels` via `llm.ts` `resolveRoleModel`; every LLM call goes through `chatCompletionWithTools` (OpenAI-compatible, proxied via Electron main when available).

### Capability system (`agent/capabilities/`) — Pydantic AI 2.0 style

The central abstraction for the FC path. `AgentCapability` bundles tools + instructions (runbook) + `modelSettings` + `approvalTools` into one unit. Key mechanics, all in `runtime.ts` and consumed by `toolLoop.ts`:

- **Progressive disclosure**: `deferLoading` caps appear only as one catalog line in the system prompt until the model calls `load_capability`; loading reveals tool schemas + runbook together. Skill (`skill:<name>`, from `hermes/skills.ts`) and MCP (`mcp:<serverId>`, prefix-owned `mcp_<id>_*` tools) capabilities are generated dynamically at assemble time.
- **Cross-step + cross-run resume**: within a run, `state.loadedCapabilityIds` is preloaded each step; after a run, ids + `unlockedToolNames` are stored on the thread (`lastCapabilityIds` / `lastUnlockedTools`) and re-injected via `dispatchThreadTask` → `preloadCapabilityIds` / `preloadUnlockedTools`.
- **Tool Search**: when visible schemas exceed `settings.toolSearchThreshold`, non-core defs are hidden; `tool_search(query)` reveals matches and auto-loads their owning capability. Unlocks persist across steps/runs with caps.
- **CodeMode**: `run_code` (`tools/codeMode.ts`) executes model-written JS in a Blob Web Worker with `fetch`/`XHR`/`WebSocket` disabled (must use `tools.http_fetch`); inner `tools.<name>(args)` RPC through the same gate + `authorizeTool`, recorded as `run_code›<tool>`.
- **Approval**: `approvalTools` on an active capability forces a HITL ask that allow-patterns cannot bypass (`toolGuard.ts` `forceAsk`). Shell also declares `bash`.
- **Leaf isolation**: `assembleCapabilities({ blockedTools })` strips empty packs from the deferred catalog; `delegate_task.inherit_capabilities[]` optionally preloads extra packs in the child.
- Framework tool names (`load_capability`, `tool_search`, `run_code`) are reserved constants in `builtins.ts`.

### Tool layer (`agent/tools/`)

`registry.ts` (catalog + `ToolName` union) → `schemas.ts` (OpenAI defs) → `executor.ts` (actual I/O through `window.subagents.*` IPC with browser fallbacks) → `toolGuard.ts` (`authorizeTool`: deny / HITL ask via `permissionAskStore`, shared by FC and heuristic paths) → `supervisor.ts` (payload byte limits, round budgets; can halt or truncate).

Adding a tool touches: `registry.ts` (name + catalog entry), `schemas.ts` (params), `executor.ts` (implementation), and an owning capability in `capabilities/builtins.ts` — otherwise it is ungated.

### Supporting layers

- **Hermes** (`agent/hermes/`): skills (SKILL.md playbooks; `learning.ts` drafts new skills/memory from successful runs → surfaces in Learning page), durable memory, **ContextPacket** budgets (`contextPacket.ts` + `promptBuilder.ts`), `delegate.ts` (leaf/orchestrator isolation with `DelegationBudget` depth+concurrency caps; leaves get `blockedTools` and no parent transcript), `backgroundJobs.ts` (fire-and-forget delegates; coordinator Archive link-only when `preferRunTask`, hidden worker threads), minimal MCP client.
- **OpenCode** (`agent/opencode/`): permission policies per agent mode (build/plan), bash pattern allow/ask/deny (`agentRegistry.ts`), transcript compaction.
- **Electron** (`electron/`): main-process bridges (webhook server, Telegram gateway, MCP stdio/http, shell, pty, project/codegraph). Exposed via preload as `window.subagents.*`. Renderer code must always feature-detect (`window.subagents?.x`) because the app also runs in a plain browser.

### Settings

One flat `LlmSettings` object. Adding a field requires three edits: the interface in `agent/types.ts`, the default in `DEFAULT_LLM_SETTINGS` (`agent/llm.ts`), and UI in `pages/SettingsPage.tsx`. Persisted to localStorage + Electron `settings` IPC; merged in `store/settingsStore.ts` (array/object fields need explicit merge handling there). Settings updates live-apply to the running engine via `agentEngine.configure`.
