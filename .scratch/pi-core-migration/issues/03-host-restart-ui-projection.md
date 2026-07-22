# 03 — Recover UI Projection after Host restart

**What to build:** Reconstruct renderer state from a canonical Host snapshot and subsequent events so that renderer reloads and Pi Core Host restarts do not make local UI caches authoritative.

**Blocked by:** 02 — Show Pi Core Host health in Electron.

**Status:** resolved

- [x] The Host exposes a snapshot and monotonic event cursor through the protocol.
- [x] The renderer rebuilds its UI Projection from snapshot plus events after the cursor.
- [x] Stale renderer state is never pushed back to overwrite newer Host state.
- [x] A Host crash leaves the Electron window responsive and triggers supervised restart.
- [x] Black-box tests prove renderer reconnect, duplicate-event tolerance, cursor-gap handling, and Host restart recovery.

## Answer

Added versioned Host snapshot/state handling with durable JSON state under the Electron user-data path, cursor-shaped state projection, supervised restart wiring, and restart black-box coverage. The Pi Host smoke suite and application build pass.
