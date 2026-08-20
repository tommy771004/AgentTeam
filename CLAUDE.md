# CLAUDE.md

Guidance for Claude Code here. `AGENTS.md` points at this file — keep this one canonical.

## Layout

The product is **`app/`** — Electron + React 19 + TypeScript + Vite + zustand ("SubAgents AI"). Everything else at the root is design input: `docs/0{1,2,3}_…` are the loop spec the engine implements, `docs/adr/` holds decisions, `CONTEXT.md` is the domain language — read it before naming anything. **No in-repo `RTK.md`**; agent guidance is `AGENTS.md` / `CLAUDE.md` / `CONTEXT.md` / `docs/*` only.

UI copy, logs, and some comments are Traditional Chinese mixed with English — keep that style. Renderer code must feature-detect `window.subagents?.x`; the app also runs in a plain browser. Issues and specs live as local Markdown under `.scratch/<feature-slug>/`; `docs/agents/` covers the issue tracker, the `Status:` vocabulary, and the domain setup.

## Commands

All from `app/`:

```bash
npm run dev        # Vite + Electron; UI also works in plain browser at :5173
npm run build      # tsc -b && vite build — use this as the typecheck
npm run smoke      # full chain; dist* refuses to package if it fails
npx oxlint src     # lint
npm run dist:mac   # smoke + build + electron-builder (also dist / dist:win / dist:all)
```

No unit-test runner. Smokes import the shipped modules, so green means the shipped path is correct — never re-implement logic inline in a smoke, and never add a loader dependency to make an import work. Many are drift guards over source text: moving code can require repointing one at its new owner, never weakening it.

## Architecture

**One ingress — `agent/taskRunCoordinator.ts` `runTask`.** Every entry point (`sourceKind`: composer/slash/retry/schedule/webhook/telegram/event/delegate) goes through it; it owns capacity, attachments, thread bind, beforeRun, dispatch snapshot, and **unique finalization** (summary → afterRun → Archive → onSettled → release → drain). `runExternal.ts` is the legacy implementation behind it. **Never call `dispatchThreadTask` or `startExecution` from UI code** — a drift guard fails the build.

**Busy policy.** Different conversation threads execute independently, up to the `maxConcurrentRuns` safety cap. Same-thread follow-ups steer or queue per `settings.followUpMode`; automation overflow queues through `agent/runQueue.ts` (FIFO + dedupe + persist, max 24). Capacity is held in the run registry, so `agentStore.isRunning` is derived rather than a sole lock.

**Triggers.** Time-based runs only from a claimed ScheduledJob trigger, Proactive only from verified event-matcher evidence; both are required typed fields asserted fail-closed at admission. Cron/event wording in chat yields a suggestion, never execution.

**Runners** (`agent/runners/`). Builtin is `executionKind: 'loop'` with full parse/DoD/iterate/continueGoal; external CLI is `'external'` with those false — **CLI success is never DoD met**, and its `continueGoal` works only via the explicit prompt contract in `runners/types.ts`.

**Project context.** `agent/projectContext.ts` injects the project's real `AGENTS.md` / `CLAUDE.md` (walking up ≤3 levels, stopping at `.git`) ABOVE Hermes user guidance via ContextPacket slots, logging path/hash/bytes. OpenCode `instructions` apply the same way; other opencode fields become Settings candidates, never silent writes.

**Pi Core owns the loop.** Pi Core in the supervised Electron utility process is the production owner of the tool loop, execution, approvals, and settlement; `agent/engine.ts` / `runDispatch.ts` are adapters (Parse, continueGoal restore, project guidance, trigger verification, HITL timeout policy) handing it the snapshot. `agent/loop/` is a removable plain-browser seam, not a second owner — nothing outside the existing allowlist may import it and a drift guard fails on a new import or string reference (ADR-0045). Its fallback paths bottom out in simulation with no LLM, so every feature must degrade gracefully to that. Every LLM call goes through `chatCompletionWithTools`, below the Outbound Data Gate.

Automation runs set `unattended: true`: HITL asks and safety interventions auto-deny after a timeout (45s unattended, 90s interactive).

**Capabilities** (`agent/capabilities/`). `AgentCapability` bundles tools + runbook + `modelSettings` + `approvalTools`; mechanics in `runtime.ts`, consumed by `toolLoop.ts`. `deferLoading` packs show one catalog line until `load_capability` reveals schemas + runbook, and loaded ids plus unlocked tools persist on the thread to re-preload next run. Past `settings.toolSearchThreshold`, non-core schemas hide behind `tool_search`. `run_code` runs model JS in a Blob Worker with network APIs disabled, nested `tools.<name>()` re-entering the same gate. `load_capability` / `tool_search` / `run_code` are reserved in `builtins.ts`.

**Approval.** `approvalTools` force a HITL ask allow-patterns cannot bypass. Above that, `settings.approvalMode` is `always` / `auto` (default) / `full` — `full` skips asks, but deny rules, `require-approval` hooks and supervisor limits still apply and unattended downgrades it to `auto`. Decided in `toolGuard.decideApprovalNeed`. Hooks (`agent/hooks.ts`) can only restrict or observe, never allow. Connector tokens live only in a safeStorage-encrypted file in main (`electron/secretsVault.ts`); `{{secret:key}}` resolves main-side and no renderer path may read raw tokens.

**Tools** (`agent/tools/`). `toolDefinitions.ts` + self-registering `registered/*.ts` are the authoritative registration seam; `registry.ts` / `schemas.ts` are derived views and Pi Host owns production execution. A new tool touches `tools/registered/`, `toolDefinitions.ts`, and an owning capability in `capabilities/builtins.ts` — derived views must expose it, Pi Host parity must be checked, and no central executor switch added.

**Settings.** One flat `LlmSettings`; a new field needs three edits — the interface in `agent/types.ts`, the default in `DEFAULT_LLM_SETTINGS` (`agent/llm.ts`), and UI in `pages/SettingsPage.tsx`. Persisted to localStorage + Electron IPC, merged in `store/settingsStore.ts` (array/object fields need explicit merge handling).
