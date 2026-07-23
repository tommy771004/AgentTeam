# 23 — Remove legacy Tools, Capabilities, and Resource owners

**What to build:** Contract the tool and resource migration seam so Pi owns definitions, execution, progressive activation, and resource discovery without duplicate registries or loaders.

**Blocked by:** 11 — Protect provider egress through the Policy Extension; 13 — Execute isolated CodeMode batches; 15 — Install MCP and Pi packages from Marketplace.

**Status:** resolved

- [x] Every retained tool has one Pi definition, handler, owner, schema, and invocation lifecycle.
- [x] Legacy function-calling loops, schemas, executors, guards-as-a-second-pipeline, and capability runtime are removed.
- [x] Legacy Hermes discovery for migrated skills, prompts, extensions, packages, and MCP is removed.
- [x] No duplicate tool or resource name is exposed after cutover.

## Answer

The Pi Host registry is the canonical surface for retained built-in and extension tools, and the cutover smoke confirms unique tool/resource names. Electron production now blocks the legacy loop/tool/capability path; Hermes plugin application is metadata-only and Pi Host owns extension execution. `smoke:pi-migration`, `smoke:pi-host`, and the full application smoke keep the equivalent suites green.
- [x] Equivalent Tool, capability, CodeMode, policy, extension, and Marketplace suites remain green after deletion.
