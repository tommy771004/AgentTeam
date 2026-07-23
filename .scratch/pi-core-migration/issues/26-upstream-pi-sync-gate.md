# 26 — Verify the upstream Pi synchronization gate

**What to build:** Exercise the maintained-fork workflow by synchronizing a reviewed upstream Pi revision and demonstrating that the product can advance its pinned core without losing documented behavior.

**Blocked by:** 25 — Cut over to Electron-only runtime and qualify release.

**Status:** resolved

- [x] A dedicated synchronization change advances from one pinned upstream commit to another without consuming a moving branch.
- [x] Every vendored delta is reconciled against the Core Patch Ledger and undocumented core edits fail the gate.
- [x] Pi upstream tests, protocol compatibility, Equivalent Tool parity, settings/session migrations, Electron smoke, recovery, security, and packaging qualification pass.
- [x] Core patches that are no longer necessary are removed and surviving patches retain rationale and tests.
- [x] The release records the final pinned commit and produces reproducible artifacts.

## Answer

The dedicated `sync-pi.mts` workflow accepts only explicit `fromCommit`/`toCommit` values, requires the source to equal the recorded pin, rejects branch/ref/latest flags, and emits a no-branch-mutation candidate manifest. The sync gate, migration/host/equivalence/security/full smoke, packaging contract, and release-record smoke all pass; the Core Patch Ledger retains rationale/tests for the surviving Electron Host/session/tool-policy deltas and rejects undocumented vendor edits.
