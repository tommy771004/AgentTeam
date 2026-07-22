# 23 — Remove legacy Tools, Capabilities, and Resource owners

**What to build:** Contract the tool and resource migration seam so Pi owns definitions, execution, progressive activation, and resource discovery without duplicate registries or loaders.

**Blocked by:** 11 — Protect provider egress through the Policy Extension; 13 — Execute isolated CodeMode batches; 15 — Install MCP and Pi packages from Marketplace.

**Status:** 可交給代理

- [ ] Every retained tool has one Pi definition, handler, owner, schema, and invocation lifecycle.
- [ ] Legacy function-calling loops, schemas, executors, guards-as-a-second-pipeline, and capability runtime are removed.
- [ ] Legacy Hermes discovery for migrated skills, prompts, extensions, packages, and MCP is removed.
- [ ] No duplicate tool or resource name is exposed after cutover.
- [ ] Equivalent Tool, capability, CodeMode, policy, extension, and Marketplace suites remain green after deletion.
