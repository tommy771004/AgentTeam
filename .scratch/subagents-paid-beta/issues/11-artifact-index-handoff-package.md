# 11 — 建立 Artifact Index 與可攜式 Handoff Package

**What to build:** Index a task's specifications, tickets, diffs, tests, reviews, decisions, and outputs, then generate a compact local Handoff document when the user requests it.

**Blocked by:** 10 — 在 Composer 加入核准模式與 Handoff 入口.

**Status:** ready-for-agent

- [ ] A task creates and updates a local Artifact Index without duplicating full transcripts or large artifacts.
- [ ] Index entries retain stable identity, type, status, source reference, digest or revision, and timestamp.
- [ ] Spec, ticket, test, diff, review, decision, and final-output evidence can be referenced.
- [ ] Handoff generation produces a local portable document with current status, decisions, blockers, references, and suggested next skills.
- [ ] Existing specs and artifacts are linked rather than copied into conflicting second versions.
- [ ] Handoff generation is explicit, local-only, repeatable, and does not call an external delivery service.
- [ ] Missing or stale references are reported without silently claiming delivery success.
