# 22 — Remove legacy Settings, Model, and Session owners

**What to build:** Contract the migration seam after Pi has proven canonical settings, model/provider transport, session persistence, history, and compaction behavior.

**Blocked by:** 05 — Migrate existing provider credentials and settings; 07 — Resume, fork, and compact durable Pi conversations; 11 — Protect provider egress through the Policy Extension.

**Status:** resolved

- [x] No production path reads overlapping legacy provider, model, thinking, tool, compaction, or session settings.
- [x] Legacy settings are removed only after migration telemetry/fixtures prove success and retry safety.
- [x] Model calls, session history, and compaction have exactly one production owner in Pi Core.
- [x] Renderer localStorage no longer acts as canonical conversation or runtime state.

## Answer

Host-owned Pi sessions are projected into a disposable renderer view; Electron renderer localStorage is not written or read as canonical conversation state when the Pi Host bridge is present. `settingsStore` strips Pi-owned runtime fields, and `piHostEntry` migrates legacy credentials into Pi `auth.json` with a success-only retry marker. The renderer engine remains dynamically available only for browser-only compatibility tests; Electron dispatch rejects a missing Pi Host.
- [x] All affected smoke tests pass through protocol-observable behavior without a fallback dual owner.
