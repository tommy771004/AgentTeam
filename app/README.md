# AgentStudio

Cross-platform desktop app (macOS & Windows) for the **AI Agent Loop** multi-agent framework.

Built with **Electron + React + TypeScript + Tailwind CSS**.

## Features

- **4 Loop Patterns** from the system specs:
  - Turn-based (1 input = 1 action, user ACK)
  - Goal-based (autonomous iteration until Definition of Done)
  - Time-based (cron-style, halt if source unreachable)
  - Proactive (strict boolean event matching)
- Prompt schema parser (`03_Agent_Prompt_Schema`)
- **Multi-agent roles** — Manager / Analyzer-1 / Writer per step
- **OpenAI-compatible LLM** (optional) via Settings + Electron main-process proxy
- **Safety gate / HITL** — Manual Intervention on sensitive payloads
- **Agent tools** — `web_search`, workspace sandbox R/W, `http_fetch`, memory, `json_extract`
- **Capabilities (Pydantic AI 2.0 style)** — tools+instructions+model settings bundled per capability, progressive disclosure via `load_capability`, **Tool Search** (`tool_search` reveals hidden schemas by keyword), **CodeMode** (`run_code` batches tool calls in a sandboxed worker, approval-gated), capability-declared human approval — see `../docs/PYDANTIC_AI_V2_CAPABILITIES.md`
- **Scheduler** — Time-based jobs (daily / interval / once), auto-run when due
- **Proactive events** — strict boolean predicates + event simulator
- **Knowledge Extraction** — entities + relationship graph + confidence heatmap
- **Report Preview** modal (Final Output Payload)
- **Manual Parameter Override** on failure (max iterations / min confidence / timeout)
- Live execution console, tool call stream, step timeline, sub-agent topology
- Local execution archive (persisted via Electron `userData`)

## Develop

```bash
cd app
npm install
npm run dev
```

This starts Vite + Electron. The browser URL at `http://localhost:5173` is a
**plain-browser UI/degraded preview** only; it does not provide production Pi
Core Host execution or its durable authority guarantees.

## Readiness vocabulary

- **compile success** — `npm run build`; compilation only, never a release claim.
- **deterministic qualification** — `npm run qualify:deterministic`; blocking,
  non-interactive repository guards without Electron App launch or signing.
- **platform qualification** — explicit macOS/Windows runtime, installer,
  signature/notarization, and clean-machine evidence jobs.
- **release-ready** — the release workflow verifies one coherent immutable
  candidate and its receipts; package success alone cannot reach this state.
- **Paid Beta GO** — only the Paid Beta qualifier may declare it after every
  required external and automated criterion passes. The retained local report
  is currently **NO-GO (0/49)**.

`npm run smoke` is the full repository qualification. `build` and `dist:*`
remain compilation/packaging-only and never imply any later readiness state.

## Build installers

`build` and `dist:*` are compilation/packaging-only. Run `npm run check` or
`npm run smoke` separately when qualification is required; installer builds do
not launch Electron E2E.

```bash
# Current platform
npm run dist

# macOS (dmg, x64 + arm64)
npm run dist:mac

# Windows (NSIS x64)
npm run dist:win
```

Artifacts land in `app/release/`.

## Project layout

```
app/
  electron/          # Main process + preload
  src/
    agent/           # Loop engine, parser, types
    components/      # Shared UI
    pages/           # Protocols, Execution, Docs, Archive, Success, Failed
    store/           # Zustand state
```

## Spec sources

Root-level design docs and Stitch HTML mocks:

- `01_System_Definition (系統定義).md`
- `02_Execution_Rules (執行規則).md`
- `03_Agent_Prompt_Schema (解析模板).md`
- `ai_agent_loop_*/code.html`
- `synthetic_intelligence_interface/DESIGN.md`
