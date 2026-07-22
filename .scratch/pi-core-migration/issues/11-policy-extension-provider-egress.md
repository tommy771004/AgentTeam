# 11 — Protect provider egress through the Policy Extension

**What to build:** Preserve the existing outbound-provider protection and evidence behavior when model traffic moves to Pi, without creating a second permission system.

**Blocked by:** 05 — Migrate existing provider credentials and settings; 06 — Run the first Pi-backed Chat turn.

**Status:** 可交給代理

- [ ] Pi provider hooks invoke the single Policy Extension before protected content leaves the application.
- [ ] Allow, sanitize, exclude, deny, and fail-closed outcomes remain externally observable and policy-compatible.
- [ ] Security evidence preserves its constrained schema and never records protected plaintext.
- [ ] Provider-specific security profiles remain isolated and apply to the selected Effective Agent Profile.
- [ ] UI copy states that model activity is governed while Trusted Extension host actions are not sandboxed by this hook.
