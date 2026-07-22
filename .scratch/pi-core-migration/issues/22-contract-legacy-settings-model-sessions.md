# 22 — Remove legacy Settings, Model, and Session owners

**What to build:** Contract the migration seam after Pi has proven canonical settings, model/provider transport, session persistence, history, and compaction behavior.

**Blocked by:** 05 — Migrate existing provider credentials and settings; 07 — Resume, fork, and compact durable Pi conversations; 11 — Protect provider egress through the Policy Extension.

**Status:** 可交給代理

- [ ] No production path reads overlapping legacy provider, model, thinking, tool, compaction, or session settings.
- [ ] Legacy settings are removed only after migration telemetry/fixtures prove success and retry safety.
- [ ] Model calls, session history, and compaction have exactly one production owner in Pi Core.
- [ ] Renderer localStorage no longer acts as canonical conversation or runtime state.
- [ ] All affected smoke tests pass through protocol-observable behavior without a fallback dual owner.
