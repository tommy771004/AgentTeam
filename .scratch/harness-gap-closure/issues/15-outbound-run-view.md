# 15 — Show what a run sent outbound

**What to build:** A per-run view of what left the machine, what was redacted, and which provider received it.

**Blocked by:** None.

**Status:** 可交給代理

`agent/outbound/` is 21 modules backed by ADR-0004 through ADR-0022 — a four-stage gate (`off` / `demo` / `optional` / `required`), text and image sanitisation, sanitized workspace, evidence ledger and upload, policy store/merge/schema/admin, device enrollment. Even LLM calls pass through it, with `window.subagents.llm.chat` recording metadata-only egress evidence in main.

The compared harness has sandboxing, which governs what a process may touch, and no egress or DLP control at all, which governs where data may go. Those are orthogonal, and the second is what enterprise buyers actually ask about.

Right now it is entirely backend policy. Nobody can see it working.

- [ ] A run detail view shows what was sent outbound during that run, what was redacted, and to which provider.
- [ ] LLM egress appears alongside tool egress, since both pass the same gate.
- [ ] The active guard mode is shown, and the view explains what that mode permitted or blocked for this run.
- [ ] Redactions show what class of content was removed, not the removed content itself.
- [ ] The view is a projection of metadata already recorded at the gate — no new collection.
- [ ] Raw credentials are never surfaced; no renderer path is added that could read them from the vault.
- [ ] Runs under `off` or `demo` mode are distinguishable from runs that were genuinely gated.
- [ ] A smoke asserts the projection contains the expected egress entries and no raw secret material.

Files: `app/src/agent/outbound/outboundGate.ts`, `app/src/agent/outbound/evidenceLedger.ts`, `app/src/agent/outbound/textSanitize.ts`, `app/src/agent/outbound/imageSanitize.ts`, run detail view.
