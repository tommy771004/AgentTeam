---
status: accepted
---

# Record outbound decisions without content

Electron main writes one append-only JSONL Security Evidence Record for every outbound decision under `required` or active `optional` protection. Records include timestamp, run ID, immutable provider ID, guard mode, policy source and version, classifier attempts and status, final action, and only source plus format-specific locator for exclusions. They never persist prompt or file content, model output, protected plaintext, or a content digest. `off` records mode transitions rather than per-request evidence, and renderer code may query summaries but cannot write the evidence file.

The same Security Evidence Ledger is the single history for typed `outbound-decision`, `policy-change`, `policy-rollback`, `guard-mode-change`, `workspace-sync`, `device-retired`, `device-replaced`, and `evidence-verification` events. Policy Admin and audit tooling read this ledger rather than maintaining a separate change log. Policy-change records describe reason, rule IDs, changed field names, and rollback relationships without copying policy-sensitive values; complete policy versions remain in the policy store.

The ledger rotates physically as one JSONL file per ISO week, for example `2026-W30.jsonl`. Event types remain mixed in chronological order within that weekly file and are classified through the `eventType` field and Policy Admin filters rather than separate category files. The first record of a new week links to the prior week's terminal MAC so the logical ledger remains one continuous chain.

Company Base Policy sets `retentionWeeks`; a positive value retains that many weekly files and `0` retains them indefinitely. In `workspace` or `both` evidence delivery, a local weekly file is never removed under retention until the central Workspace acknowledges receipt. Pending uploads survive ordinary retention, and policy-driven removal is represented by a `retention-checkpoint` so normal truncation is distinguishable from unexplained loss.

Weekly file boundaries use the fixed IANA timezone `Asia/Taipei` with ISO weeks beginning Monday. Individual event timestamps remain UTC ISO-8601 so records can be correlated across systems without depending on a device's local timezone.

Formal evidence delivery supports `local`, `workspace`, and `both`. Local policy source defaults to `local`; `required` guard with Workspace policy source defaults to `both`. Workspace-only delivery retains a local pending queue until acknowledgement, while both retains the weekly local ledger after acknowledgement. Demo uses temporary unsealed local evidence and never claims formal delivery.

Workspace delivery is incremental in the background rather than a weekly whole-file upload. Every event is durably appended to the local ledger or pending queue first, then sent in small batches identified by idempotent event ID and monotonic sequence. Workspace acknowledges the highest durable sequence; failure leaves the queue intact and does not stop the current AI service. Closing a weekly file sends its terminal MAC and weekly checkpoint after outstanding events are acknowledged.

Workspace stores events under workspace ID plus Managed Device ID so records from multiple computers remain independently queryable. Local ledgers, pending queues, and classifier requests use the same opaque device identifier; it is never derived from hostname, user name, MAC address, disk serial, or another hardware fingerprint.

Workspace enrollment provisions a distinct evidence HMAC key for each Managed Device ID. Electron main stores it through OS safe storage and Workspace retains the corresponding key to verify that device's uploaded chain; keys are never shared across devices. Local policy source generates its own local key, demo has no key, and re-enrollment rotates to a new key without discarding historical keys needed to verify older weekly files.

Each canonical record also carries a monotonic sequence, the previous record MAC, and an HMAC produced with a key held in OS safe storage. The chain covers evidence metadata only, not prompt or file content. Verification reports intact, broken, or truncated chains so local edits, insertion, deletion, and reordering are detectable. This evidence seal is independent from the deferred digital signature of policy files.

Company Base Policy chooses `block` or `unsealed` when OS safe storage cannot provide the HMAC key. `block` stops only AI egress; `unsealed` continues service with evidence visibly marked unverifiable. The system never persists the HMAC key as plaintext. Defaults are `block` for `required` guard and `unsealed` for `optional` guard.

Demo guard writes only temporary unsealed evidence and is always labelled non-verifiable. It can demonstrate classification, sanitized direct-LLM requests, sanitized CLI workspaces, and safe write-back, but it cannot be presented as company security assurance.
