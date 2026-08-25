---
status: accepted
---

# Keep builtin shell outside the required external-CLI sandbox scope

## Context

ADR-0022 makes verified filesystem isolation mandatory for an external CLI in
Outbound Guard `required` mode. The builtin `bash` tool is a different
execution path and needs a platform probe, profile construction, and evidence
semantics of its own; borrowing the external-CLI wrapper would have been a
scope expansion that proves nothing about this path.

Running builtin shell under `required` without verified isolation would make
the strict-mode claim more than the runtime can prove. That was the whole
question, and ADR-0051 has since answered it: builtin shell gets its own
Host-owned verified sandbox seam, and the macOS and Linux adapters implement
it. This ADR keeps the part of the boundary that did not change.

## Decision

Builtin shell stays outside ADR-0022's external-CLI sandbox scope. The two
paths are confined separately: external CLI by ADR-0022, builtin shell by the
ADR-0051 seam and its platform adapters. Neither may attest for the other.

Under `required`, builtin `bash` is fail-closed by default and runs only when
ADR-0051 admits it — a Host-issued isolation evidence object bound to this run,
this Restricted Project View, this backend and profile digest, and unexpired.
Verification alone is not permission: the command must also execute confined by
the adapter that issued that evidence, so an admitted-but-unwrapped shell is
refused rather than run on the open host. `unsupported`, probe failure and
canary failure are refusals and never degrade to `optional`.

The superseded form of this rule trusted a caller-supplied
`shellIsolationVerified` boolean. That field is gone: a renderer, a tool
argument, or model text can no longer describe the runtime as isolated
(ADR-0048).

Under `optional`, builtin shell may run in degraded mode with the existing
command/path guard; under `off`, the existing unrestricted policy applies.

This is an intentional product boundary, not a missing fallback. Pi Core Host's
single model-builtin `tool_call` hook owns the in-turn decision. It composes the
frozen invocation policy first and then applies this outbound-shell rule before
Pi may execute `bash`. The refusal is surfaced as a Host tool decision and as
contract-bound tool evidence in the durable Turn Record. A deterministic real
Pi turn with an observable forbidden side effect is covered by
`smoke-pi-adr0047-real-turn-denial`.

## Consequences

Strict users on macOS and Linux can use builtin shell, confined to the
Restricted Project View with the network denied, once that run's backend has
passed its probe and both canaries. Windows and every platform without an
adapter remain honestly refused — the boundary this ADR drew is unchanged for
them, and an unimplemented platform is never silently downgraded.

Renderer tool handlers are not production execution owners and cannot attest
filesystem isolation.

`smoke-pi-adr0047-real-turn-denial` covers a deterministic real Pi turn on both
sides of the rule: a host with a verified backend runs the command confined and
records which backend, profile and view authorised it; a host without one still
refuses, with an observable side effect proving nothing executed.

Related: ADR-0007, ADR-0022, ADR-0045, ADR-0048, ADR-0051, and
`docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md`.
