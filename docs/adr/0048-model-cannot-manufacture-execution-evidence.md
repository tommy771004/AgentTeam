---
status: accepted
---

# A model cannot manufacture execution evidence

## Decision

Model text, tool arguments, planned state, and claimed success are not
execution evidence. A side-effect result is reportable only when the trusted
adapter that performed the effect issues a metadata-only evidence snapshot.
The snapshot is non-model-attested, scoped to a run and action, and can be
validated independently of the model output.

This generalises the evidence boundary already used for trigger claims and
outbound decisions. It does not make a model-generated string authoritative by
copying it into an evidence field.

## Consequences

`message_send`, content publishing, and future merge/push/deploy adapters must
return or persist adapter-issued evidence on success. A missing, malformed, or
model-attested snapshot is a failed side-effect result, not a successful
delivery. The evidence contains identifiers and status metadata only; it never
contains credentials or raw payloads.

Related: ADR-0026, ADR-0022, ADR-0040, and
`docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md`.
