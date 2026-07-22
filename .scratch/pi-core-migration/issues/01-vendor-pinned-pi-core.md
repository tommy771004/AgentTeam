# 01 — Vendor pinned Pi Core

**What to build:** Add the reviewed Pi fork as the project-owned foundation and prove that all four packages build within the Electron product toolchain, without changing production task dispatch yet.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] The vendored source contains `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-tui` at one recorded upstream commit.
- [x] The four packages build using the supported application Node/Electron toolchain.
- [x] Pi's license and required notices are preserved in source and distribution inputs.
- [x] A Core Patch Ledger records the upstream baseline and initially contains no undocumented project patches.
- [x] Existing production runtime behavior and smoke tests remain unchanged.

## Answer

Implemented the pinned Pi subtree at commit `dd6bea41efa8caa7a10fe5a6401676dc5699f83f`, added the vendor metadata smoke, hydrated Pi's generated model data, and verified the upstream monorepo offline build plus the smoke. The subtree merge is recorded in the Git history.
