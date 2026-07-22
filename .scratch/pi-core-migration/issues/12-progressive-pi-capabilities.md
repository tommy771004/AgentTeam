# 12 — Progressively reveal Pi tools and runbooks

**What to build:** Preserve progressive capability disclosure over Pi's sole tool loop so agents load relevant instructions and tools without exposing the entire installed catalog every turn.

**Blocked by:** 08 — Read and search projects with Equivalent Pi Tools.

**Status:** 可交給代理

- [ ] The Capability Extension catalogs deferred capabilities without maintaining a second tool-definition owner.
- [ ] Loading a capability reveals its runbook and activates its Pi tools together.
- [ ] Tool search reveals relevant hidden tools and loads their owning capability deterministically.
- [ ] Active capability/tool state persists across turns and later Task runs according to the session contract.
- [ ] Tests drive actual Pi tool calls and assert visible schemas/events rather than inspecting runtime source.
