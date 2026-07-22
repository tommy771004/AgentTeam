# 26 — Verify the upstream Pi synchronization gate

**What to build:** Exercise the maintained-fork workflow by synchronizing a reviewed upstream Pi revision and demonstrating that the product can advance its pinned core without losing documented behavior.

**Blocked by:** 25 — Cut over to Electron-only runtime and qualify release.

**Status:** 可交給代理

- [ ] A dedicated synchronization change advances from one pinned upstream commit to another without consuming a moving branch.
- [ ] Every vendored delta is reconciled against the Core Patch Ledger and undocumented core edits fail the gate.
- [ ] Pi upstream tests, protocol compatibility, Equivalent Tool parity, settings/session migrations, Electron smoke, recovery, security, and packaging qualification pass.
- [ ] Core patches that are no longer necessary are removed and surviving patches retain rationale and tests.
- [ ] The release records the final pinned commit and produces reproducible artifacts.
