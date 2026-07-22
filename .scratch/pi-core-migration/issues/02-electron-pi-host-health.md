# 02 — Show Pi Core Host health in Electron

**What to build:** Let the Electron app supervise a dedicated Pi Core Host and show its real health/version state through the first versioned Pi Host Protocol round trip.

**Blocked by:** 01 — Vendor pinned Pi Core.

**Status:** resolved

- [x] Electron starts and stops the dedicated utility process with the application lifecycle.
- [x] A client must complete versioned initialization and capability negotiation before other requests are accepted.
- [x] The renderer displays connected, unavailable, version-mismatch, and crashed Host states without importing Pi runtime code.
- [x] Host diagnostics are structured protocol events rather than parsed terminal output.
- [x] A black-box test launches the built Host entry and verifies initialization, health, graceful shutdown, and version rejection.

## Answer

Implemented the versioned Pi Host Protocol, built `pi-host.js` as a dedicated Electron utility entry, added `PiHostSupervisor`, wired lifecycle/health IPC, and exposed a renderer status pill. The protocol smoke and application build pass; the headless Electron utility smoke is retained for display-backed verification.
