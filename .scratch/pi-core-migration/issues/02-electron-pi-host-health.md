# 02 — Show Pi Core Host health in Electron

**What to build:** Let the Electron app supervise a dedicated Pi Core Host and show its real health/version state through the first versioned Pi Host Protocol round trip.

**Blocked by:** 01 — Vendor pinned Pi Core.

**Status:** 可交給代理

- [ ] Electron starts and stops the dedicated utility process with the application lifecycle.
- [ ] A client must complete versioned initialization and capability negotiation before other requests are accepted.
- [ ] The renderer displays connected, unavailable, version-mismatch, and crashed Host states without importing Pi runtime code.
- [ ] Host diagnostics are structured protocol events rather than parsed terminal output.
- [ ] A black-box test launches the real Host and verifies initialization, health, graceful shutdown, and version rejection.
