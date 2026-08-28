# 01 — Expand the External CLI Run Session seam

**What to build:** Introduce one Host-owned External CLI Run Session contract that supervises every existing external adapter without changing current user-visible execution behavior, so later durability work has one typed, deterministic integration seam.

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Every external CLI Task run still enters through `runTask` and reaches the coordinator's existing unique finalization path.
- [ ] The session contract gives each run a stable Task run identity, conversation identity, adapter identity, lifecycle phase, timing policy snapshot, cancellation state, and terminal classification.
- [ ] Electron owns the active-session registry and process authority; renderer state remains a disposable projection obtained through typed, feature-detected IPC.
- [ ] Existing Codex, Claude, Grok, Gemini, and Cursor invocations route through the same session contract without duplicating adapter command construction.
- [ ] Sanitized Workspace, Outbound Data Gate, filesystem sandbox, Approval Mode, and unattended authority remain unchanged.
- [ ] A deterministic fake clock and controllable fake CLI process transport can drive the shipped session seam without waiting on real time or network access.
- [ ] A focused smoke proves start, streamed activity, successful exit, failed exit, and one settlement through the public seam.
- [ ] Existing external/builtin loop-parity, cancellation, sandbox, coordinator, build, and full smoke checks remain green.
