# 11 — 建立 Artifact Index 與可攜式 Handoff Package

**What to build:** Index a task's specifications, tickets, diffs, tests, reviews, decisions, and outputs, then generate a compact local Handoff document when the user requests it.

**Blocked by:** 10 — 在 Composer 加入核准模式與 Handoff 入口.

**Status:** resolved
- [x] A task creates and updates a local Artifact Index without duplicating full transcripts or large artifacts.
- [x] Index entries retain stable identity, type, status, source reference, digest or revision, and timestamp.
- [x] Spec, ticket, test, diff, review, decision, and final-output evidence can be referenced.
- [x] Handoff generation produces a local portable document with current status, decisions, blockers, references, and suggested next skills.
- [x] Existing specs and artifacts are linked rather than copied into conflicting second versions.
- [x] Handoff generation is explicit, local-only, repeatable, and does not call an external delivery service.
- [x] Missing or stale references are reported without silently claiming delivery success.
