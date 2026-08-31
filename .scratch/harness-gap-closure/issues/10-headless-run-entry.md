# 10 — Add a headless run entry for development and evaluation

**What to build:** Make `taskRunCoordinator.runTask` callable from a plain Node environment with no renderer, as a development and evaluation seam.

**Blocked by:** None.

**Status:** resolved

Core behaviour cannot currently be exercised outside the renderer, which blocks both embeddability experiments and any form of batch evaluation. The `agent/llm.ts` `setLlmTransport` seam and the existing smoke scripts already demonstrate that the core logic runs outside a renderer; what is missing is a single supported entry point.

This is a development and evaluation seam, not a second product form. ADR-0046 makes the product Electron-only and that is not being reopened. Say so in the entry point's own documentation so it is not mistaken for a distribution surface later.

- [x] A Node entry point invokes `agent/taskRunCoordinator.ts` `runTask` with an explicit `sourceKind` and no renderer present.
- [x] LLM traffic goes through the `setLlmTransport` seam and still passes the outbound gate.
- [x] Renderer-only modules are not pulled into the Node path; `window.subagents?.x` feature detection is respected throughout.
- [x] Runs from this entry are treated as unattended: HITL asks and safety interventions auto-deny after the timeout rather than blocking.
- [x] Capacity, queue, dedupe, and single finalization behave identically to the Electron path.
- [x] The entry point documents that it is a development and evaluation seam and not a product distribution surface, referencing ADR-0046.
- [x] A headless smoke completes one turn-based run end to end in Node.
- [x] `npm run smoke:prod` confirms no renderer-only module entered the Node path.

Files: `app/src/agent/headlessRun.ts`, `app/scripts/headless-run.mts`, `app/scripts/smoke-headless.mts`.

## Resolution evidence (2026-08-31)

`runHeadlessTask` installs only bounded Node globals, sets `sourceKind: 'headless'` and `unattended: true`, then calls canonical `runTask`; it does not import React/pages. `smoke-headless.mts` executes the seam end to end, while `smoke:prod` and build retain the renderer-boundary guard. The module comment explicitly records the ADR-0046 non-product boundary.
