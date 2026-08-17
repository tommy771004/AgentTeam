# 10 — Add a headless run entry for development and evaluation

**What to build:** Make `taskRunCoordinator.runTask` callable from a plain Node environment with no renderer, as a development and evaluation seam.

**Blocked by:** None.

**Status:** 可交給代理

Core behaviour cannot currently be exercised outside the renderer, which blocks both embeddability experiments and any form of batch evaluation. The `agent/llm.ts` `setLlmTransport` seam and the existing smoke scripts already demonstrate that the core logic runs outside a renderer; what is missing is a single supported entry point.

This is a development and evaluation seam, not a second product form. ADR-0046 makes the product Electron-only and that is not being reopened. Say so in the entry point's own documentation so it is not mistaken for a distribution surface later.

- [ ] A Node entry point invokes `agent/taskRunCoordinator.ts` `runTask` with an explicit `sourceKind` and no renderer present.
- [ ] LLM traffic goes through the `setLlmTransport` seam and still passes the outbound gate.
- [ ] Renderer-only modules are not pulled into the Node path; `window.subagents?.x` feature detection is respected throughout.
- [ ] Runs from this entry are treated as unattended: HITL asks and safety interventions auto-deny after the timeout rather than blocking.
- [ ] Capacity, queue, dedupe, and single finalization behave identically to the Electron path.
- [ ] The entry point documents that it is a development and evaluation seam and not a product distribution surface, referencing ADR-0046.
- [ ] A headless smoke completes one turn-based run end to end in Node.
- [ ] `npm run smoke:prod` confirms no renderer-only module entered the Node path.

Files: `app/src/agent/taskRunCoordinator.ts`, `app/src/agent/llm.ts`, new Node entry under `app/scripts/` or `app/src/`, `CONTEXT.md`.
