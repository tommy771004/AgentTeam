# 01 — Vendor pinned Pi Core

**What to build:** Add the reviewed Pi fork as the project-owned foundation and prove that all four packages build within the Electron product toolchain, without changing production task dispatch yet.

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] The vendored source contains `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-tui` at one recorded upstream commit.
- [ ] The four packages build using the supported application Node/Electron toolchain.
- [ ] Pi's license and required notices are preserved in source and distribution inputs.
- [ ] A Core Patch Ledger records the upstream baseline and initially contains no undocumented project patches.
- [ ] Existing production runtime behavior and smoke tests remain unchanged.
