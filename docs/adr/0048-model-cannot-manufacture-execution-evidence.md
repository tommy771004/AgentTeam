---
status: accepted
---

# A model cannot manufacture execution evidence

## Decision

Execution credentials are produced by non-model components. Model text, tool
arguments, planned state, and claimed success are not execution evidence, and
no model output can constitute or synthesise one.

This is a **gate**, not a reporting convention. A side-effect exit refuses to
perform the effect — or refuses to report it as performed — unless the trusted
component that actually performed it issues a metadata-only evidence snapshot.
The snapshot is non-model-attested, scoped to a run and an action, and can be
validated independently of the model output.

## The two enforcement layers

The guarantee is held by two layers, deliberately redundant.

**Type-level unrepresentability.** `LoopRequest`'s `'time'` and `'proactive'`
variants require a `ScheduleTriggerSnapshot` / `EventTriggerSnapshot` field, so
an evidence-free automated request cannot be constructed at all. The same shape
now applies to side effects: `SideEffectOutcome`'s `ok: true` variant requires a
`SideEffectEvidence`, so a successful side-effect result is unrepresentable
without one.

**Fail-closed runtime refusal.** `runLoop`'s entry re-validates the trigger
snapshot, and `gateSideEffect` re-validates the evidence at each side-effect
exit. Both exist because the type system is erased at runtime: a plain-JS
caller, a deserialised IPC payload, or a cast can bypass layer one, and layer
two still fails closed. Neither layer is sufficient alone — the first makes the
mistake hard to write, the second makes it impossible to ship.

## Why `eventMatcher.ts` does not read target text

`eventMatcher.ts` intentionally does not inspect the target's text content. It
derives canonical evidence only from an adapter-supplied rule and a normalized
payload. If it read target text, a model — or anyone able to influence the
content a rule scans — could author text that manufactures a matching event and
thereby its own execution credential. Keeping the matcher blind to text is what
makes event evidence unforgeable rather than merely inconvenient to forge.

## The suggestion path

Conversation text carrying cron or event intent is not discarded, and it is not
executed either. It produces an `automationSuggestion.ts` suggestion that a user
must accept. This is the safe outlet: the model may propose automation, and only
a non-model actor may create the credential that runs it.

## Relationship to ADR-0026 and scope

ADR-0026 preserves the four loop patterns and secures this property for
Time-based and Proactive execution only, as a consequence of loop semantics.
This ADR states unforgeability as an independent principle and extends its scope
beyond loop patterns to **every outward side effect**: message sending, content
publishing, and merge / push / deploy. Approval flow is a separate axis — it is
human-in-the-loop *authorisation*, and it does not constrain what happens after
authorisation is granted. Approval mode `full` therefore does not bypass the
evidence requirement, and an unattended run cannot satisfy one by timing out
into a default.

## The contrast

In the compared harness (`deepseek-ai/deepseek-harness`), `schedule_create` is a
model-callable tool: the model can schedule itself, so its own output becomes
the execution credential. That is the exact shape this ADR forbids. The
difference is not a matter of the model being well-behaved — it is that under
this decision the request is unrepresentable and then refused, and under the
alternative it is a normal tool call.

## Consequences

`message_send`, content publishing, and merge/push/deploy adapters must obtain
adapter-issued evidence at the boundary that performed the effect, and must fail
closed without it. A missing, malformed, or model-attested snapshot is a failed
side-effect result, not a successful delivery. Evidence supplied through model
tool arguments is refused with an explicit reason rather than ignored. The
snapshot contains identifiers and status metadata only; it never contains
credentials or raw payloads.

Related: ADR-0026, ADR-0022, ADR-0040, and
`docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md` (the analysis of record).
