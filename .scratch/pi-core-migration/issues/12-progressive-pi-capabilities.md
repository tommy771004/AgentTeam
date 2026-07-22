# 12 — Progressively reveal Pi tools and runbooks

**What to build:** Preserve progressive capability disclosure over Pi's sole tool loop so agents load relevant instructions and tools without exposing the entire installed catalog every turn.

**Blocked by:** 08 — Read and search projects with Equivalent Pi Tools.

**Status:** resolved

- [x] The Capability Extension catalogs deferred capabilities without maintaining a second tool-definition owner.
- [x] Loading a capability reveals its runbook and activates its Pi tools together.
- [x] Tool search reveals relevant hidden tools and loads their owning capability deterministically.
- [x] Active capability/tool state persists across turns and later Task runs according to the session contract.
- [x] Tests drive actual Pi tool calls and assert visible schemas/events rather than inspecting runtime source.

## Answer

Added a deterministic Pi Capability catalog with deferred visibility, load/runbook coupling, search auto-load, and active-tool persistence semantics plus a smoke fixture.
