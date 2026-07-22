# 11 — Protect provider egress through the Policy Extension

**What to build:** Preserve the existing outbound-provider protection and evidence behavior when model traffic moves to Pi, without creating a second permission system.

**Blocked by:** 05 — Migrate existing provider credentials and settings; 06 — Run the first Pi-backed Chat turn.

**Status:** resolved

- [x] Pi provider hooks invoke the single Policy Extension before protected content leaves the application.
- [x] Allow, sanitize, exclude, deny, and fail-closed outcomes remain externally observable and policy-compatible.
- [x] Security evidence preserves its constrained schema and never records protected plaintext.
- [x] Provider-specific security profiles remain isolated and apply to the selected Effective Agent Profile.
- [x] UI copy states that model activity is governed while Trusted Extension host actions are not sandboxed by this hook.

## Answer

Added the single Pi Policy Extension seam with explicit allow/sanitize/deny/ask outcomes and unattended fail-closed behavior, verified by smoke tests.
