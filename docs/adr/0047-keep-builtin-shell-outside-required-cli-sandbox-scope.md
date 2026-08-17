---
status: accepted
---

# Keep builtin shell outside the required external-CLI sandbox scope

## Context

ADR-0022 makes verified filesystem isolation mandatory for an external CLI in
Outbound Guard `required` mode. The builtin `bash` tool is a different
execution path: it is an Electron IPC adapter, and the current platform
bridges do not provide a verified seatbelt/bwrap equivalent for that adapter.
Windows has no supported backend for this guarantee either.

Changing `required` to run builtin shell without verified isolation would make
the strict mode claim more than the runtime can prove. Applying the external
CLI wrapper to builtin shell is a scope expansion that needs a platform probe,
profile construction, and evidence semantics of its own.

## Decision

Do not widen ADR-0022 in this change. Under `required`, builtin `bash` remains
fail-closed and is refused when `shellIsolationVerified` is false. Under
`optional`, it may run in degraded mode with the existing command/path guard;
under `off`, the existing unrestricted policy applies. External CLI continues
to use the verified sandbox path required by ADR-0022.

This is an intentional product boundary, not a missing fallback. The refusal
is surfaced as an outbound-shell decision and covered by
`smoke-outbound-shell-evidence`.

## Consequences

Strict users cannot use builtin shell until a future ADR supplies a verified
backend. That future proposal must cover macOS seatbelt, Linux bwrap, Windows
fallback/refusal, canary probing, and metadata-only evidence before changing
the current call site in `src/agent/tools/registered/bash.ts`.

Related: ADR-0007, ADR-0022, ADR-0045, and
`docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md`.
