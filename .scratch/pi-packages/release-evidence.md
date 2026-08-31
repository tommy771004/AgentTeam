# Pi Packages 04–06 — Verification record

Date: 2026-08-31. Baseline: `8efe5b4`. Implementation and review ran in the main agent, without subagents.

## Package qualification

- `npm run build`: passed (TypeScript + renderer/main/preload/Host bundles).
- `npm run smoke:pi-packages`: passed against shipped Host bundle.
- `npm run smoke:pi-packages:built`: passed after final fixture isolation and same-session assertions.
- Changed-file oxlint and `git diff --check`: passed.

Behavior evidence:

- [Tool admission fixture](../../app/scripts/smoke-pi-package-tools.mts): installed inactive, second trust confirmation, builtin collision refusal, exact package provenance, malformed provenance rejection, stale MCP provenance precedence, same-session disable.
- [Catalog fixture](../../app/scripts/smoke-pi-package-catalog.mts): bounded npm query/results, exact version/source, conservative compatibility, explicit query only.
- [Lifecycle fixture](../../app/scripts/smoke-pi-package-lifecycle.mts): pinned install of one skill + one tool, shared Host resources for Chat/SubDesign sessions, trusted tool approval and Turn Record evidence, removal from next same-session system prompt and tool contract, active-run mutation refusal with unchanged package state and admitted contract generation.
- [Release integration](../../app/package.json): `smoke` → `qualify:pi-runtime-contract` → `smoke:pi-packages:built`.

## Full-suite execution and sequential repairs

The full `npm run smoke` was invoked once. It passed the preceding gates (including Pi Host/runtime contract/package qualification) and stopped at workspace text search. Repairs were verified individually and execution resumed at the remaining segments; no second clean monolithic full-suite run is claimed.

1. `smoke-workspace-text-search.mts`: stale source guard expected duplicated projection inside settingsStore. Repointed it to `llmSettingsFromPiHost` and checked actual true/false/absent behavior. All 21 checks passed.
2. `smoke:orphan-closure`: stopped at `smoke-pi-settings.mts`, whose arbitrary model lacked a provider. Retained invalid-request check, then provided a valid fixture provider/model. Focused settings smoke passed; subsequent orphan-closure commands passed, including queued-schedule recovery, journal, security, and update migration.
3. `smoke:pi-electron-host-e2e`: fixture inherited native Pi settings and selected a real subscription model instead of loopback. Isolated app/native Pi directories and disabled CLI OAuth bootstrap. `smoke:pi-electron-host-e2e:built` passed 2 active + 2 terminal reattach cases. Existing non-fatal review-snapshot diagnostics remain visible; this fixture has no admitted review snapshot.
4. `smoke:pi-tool-failure-detail` and `smoke:text-context-menu`: passed.

## UI check

Inspected the actual Settings → Pi Core page in the in-app browser. Narrow controls were readable; search/install buttons were corrected to remain single-line, and catalog action rows can wrap. Browser preview has no Electron bridge, so real package installation/trust interaction was verified through the Host protocol fixtures, not a live third-party install.

## Review

Standards: retained Host authority, contract/policy/evidence ownership, existing primitives, and shipped-module qualification. No outstanding finding in the changed implementation.

Spec: exact-source trust, conservative catalog compatibility and pinned install path, same-session reload/removal, and release-gate integration verified. Full-suite evidence is the sequential execution described above, not an uninterrupted rerun.

## Primary references for discovery

- [npm registry search API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)
- [Pi package documentation](https://pi.dev/docs/latest/packages)

The catalog uses npm JSON metadata and external detail links; it does not scrape pi.dev HTML.
