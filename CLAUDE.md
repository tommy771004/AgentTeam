# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The product is **`app/`** — an Electron desktop app "SubAgents AI" (React 19 + TypeScript + Vite + zustand). Everything else at the root is design input, not code:

- `docs/01_…` / `02_…` / `03_…` `.md` — the loop spec (system definition, four loop patterns, request-parsing schema) the engine implements
- `docs/` — integration plans and audits; `docs/TASK_AGENT_WORKFLOW_INTEGRATION_PLAN_2026-07-14.md` is the task lifecycle plan (Phases 0–5 done); `docs/PYDANTIC_AI_V2_CAPABILITIES.md` maps capability concepts; `docs/WORKFLOW_AUDIT.md` is the older audit ledger
- `CONTEXT.md` — product domain language
- **No in-repo `RTK.md`.** Product agent guidance is `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` / `docs/*` only.

UI copy, log messages, and some comments are Traditional Chinese mixed with English — keep that style.

## Commands

All from `app/`:

```bash
npm install
npm run dev        # Vite + Electron; UI also works in plain browser at :5173
npm run build      # tsc -b && vite build (use this as the typecheck)
npm run smoke      # smoke.mjs + smoke-caps.mjs — pure logic + Electron contract
npx oxlint src     # lint
npm run dist:mac   # smoke + build + electron-builder (also dist / dist:win / dist:all)
```

There is no unit-test runner; smoke scripts cover scheduler math, event matching, capability/compaction pure logic, and the built Electron preload/main contract. `dist*` refuses to package if smoke fails.

## Architecture

### Execution flow (default single run; optional capped concurrency)

All entry points go through ONE lifecycle controller — **`agent/taskRunCoordinator.ts` `runTask`**. Callers pass `sourceKind` (`composer`/`slash`/`retry`/`schedule`/`webhook`/`telegram`/`event`/`delegate`); the one-way internal graph is `taskRunContracts.ts` → `taskRunExecution.ts` → `taskRunLifecycleSupport.ts` / `runDispatch.ts`, owning capacity, attachments, thread bind, beforeRun, the admitted dispatch snapshot, and **unique finalization** (summary → afterRun → Archive → onSettled → release → drain). Product code imports only the coordinator; **never import internals or call `dispatchThreadTask` / `startExecution` from UI code**.

On busy, `resolveBusyPolicy` decides: automation sources **queue** (`agent/runQueue.ts`, FIFO + dedupe + localStorage persist, max 24); interactive sources **steer** or queue per `settings.followUpMode`. With `concurrentRunsEnabled` (default **false**), a capped registry (`maxConcurrentRuns`) allows multiple `runId`s (ADR-0003). `agentStore.isRunning` is derived from the registry, not a sole global mutex.

**Time-based** only via claimed ScheduledJob trigger; **Proactive** only via verified event matcher evidence. Conversation text with cron/event intent yields an automation **suggestion**, not execution.

**Runners** (`agent/runners/`): builtin `executionKind: 'loop'` has full Parse/DoD/iterate/continueGoal/capabilities; external CLI is `executionKind: 'external'` with only run-scoped progress until a continueGoal prompt contract is enabled. CLI must not present as DoD met.

Per run, the engine resolves **project context** (`agent/projectContext.ts` → `project:agentsDocs` IPC): real `AGENTS.md`/`CLAUDE.md` files from the project root (walking up ≤3 levels, stopping at `.git`), injected into prompts ABOVE Hermes user guidance via **ContextPacket** slots, with path/hash/bytes logged for audit. OpenCode `instructions` are temporary-applied the same way; other discovered opencode fields surface as candidates in Settings →「OpenCode 匯入報告」(temporary / review / unsupported — `agent/opencode/configCandidates.ts`), never silently written to Settings.

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
- **Approval**: `approvalTools` on an active capability forces a HITL ask that allow-patterns cannot bypass (`toolGuard.ts` `forceAsk`). Shell also declares `bash`. On top sits the ChatGPT-style `settings.approvalMode` — `always` (ask before any side-effect/network tool), `auto` (default; ask only on unsafe signals), `full` (skip asks and safety interventions; deny rules and supervisor limits still apply; unattended runs downgrade `full` → `auto` via `effectiveApprovalMode`) — decided centrally in `toolGuard.decideApprovalNeed` (custom http/bash template tools are flagged via a `sideEffect` hint since their names aren't statically known) and surfaced as a composer pill (`ApprovalModeMenu`) + Settings.
- **Leaf isolation**: `assembleCapabilities({ blockedTools })` strips empty packs from the deferred catalog; `delegate_task.inherit_capabilities[]` optionally preloads extra packs in the child.
- Framework tool names (`load_capability`, `tool_search`, `run_code`) are reserved constants in `builtins.ts`.

### Tool layer (`agent/tools/`)

`registry.ts` (catalog + `ToolName` union) → `schemas.ts` (OpenAI defs) → `executor.ts` (actual I/O through `window.subagents.*` IPC with browser fallbacks) → `toolGuard.ts` (`authorizeTool`: deny / HITL ask via `permissionAskStore`, shared by FC and heuristic paths) → `supervisor.ts` (payload byte limits, round budgets; can halt or truncate).

Adding a tool touches: `registry.ts` (name + catalog entry), `schemas.ts` (params), `executor.ts` (implementation), and an owning capability in `capabilities/builtins.ts` — otherwise it is ungated.

### Governance & security layers

- **Approval hooks** (`agent/hooks.ts`): declarative lifecycle rules (beforeRun/beforeTool/afterTool/afterRun) from `settings.hookRules` + plugin manifests, sanitized on collect. Rules can only restrict/observe (deny / require-approval / append-context / log / notify — no allow); `require-approval` overrides even approvalMode `full`. Evaluated by the Task run coordinator (run points), `toolGuard` (beforeTool), and `toolLoop` (afterTool).
- **Credential vault** (`electron/secretsVault.ts`): connector tokens live ONLY in a safeStorage-encrypted file in main. Renderer sees metadata (`pluginSecrets.ts` mirror); `{{secret:key}}` placeholders are resolved main-side (tools:httpRequest, mcp http/stdio). Never add a renderer path that reads raw tokens.
- **Model profiles** (`agent/modelProfile.ts`): per-model capability facts (`settings.modelProfiles`) with provenance (verified via explicit probe / assumed / unknown). Engine degrades BEFORE calls fail: `tools:false` → heuristic path, `vision:false` → images become path notes.
- **Tool packages** (`agent/tools/toolPackage.ts`): plugins may ship a `toolPackage` manifest where every tool declares `operationClass` (read/write/destructive/external). Unapproved privilege surfaces compile read-only; escalating updates change the fingerprint and require re-approval in Settings.

### Supporting layers

- **Hermes** (`agent/hermes/`): skills (SKILL.md playbooks; `learning.ts` drafts new skills/memory from successful runs → surfaces in Learning page; `onUserTurn` only on coordinator-accepted composer/slash/retry), durable memory, **ContextPacket** (`contextPacket.ts` + `promptBuilder.ts`), `delegate.ts` (leaf/orchestrator isolation with `DelegationBudget` depth+concurrency caps; leaves get `blockedTools` and no parent transcript), `backgroundJobs.ts` (fire-and-forget; single Archive when via coordinator; hidden worker threads), minimal MCP client.
- **OpenCode** (`agent/opencode/`): permission policies per agent mode (build/plan), bash pattern allow/ask/deny (`agentRegistry.ts`), transcript compaction.
- **Electron** (`electron/`): main-process bridges (webhook server, Telegram gateway, MCP stdio/http, shell, pty, project/codegraph). Exposed via preload as `window.subagents.*`. Renderer code must always feature-detect (`window.subagents?.x`) because the app also runs in a plain browser.

### Settings

One flat `LlmSettings` object. Adding a field requires three edits: the interface in `agent/types.ts`, the default in `DEFAULT_LLM_SETTINGS` (`agent/llm.ts`), and UI in `pages/SettingsPage.tsx`. Persisted to localStorage + Electron `settings` IPC; merged in `store/settingsStore.ts` (array/object fields need explicit merge handling there). Settings updates live-apply to the running engine via `agentEngine.configure`.

## Agent skills

### Issue tracker

Issues and specs are tracked as local Markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Local issue `Status:` fields use the repository's Traditional Chinese status vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using the root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
