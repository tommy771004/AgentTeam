# Core Patch Ledger

This file is the review ledger for the vendored Pi Core revision recorded in
`PI_UPSTREAM_PIN.json`. A synchronization change must update the pin first,
then reconcile every intentional delta here. The sync gate rejects a vendor
tree whose recorded hash no longer matches the pin.

Reconciled against `v0.84.3` (`4e58f324fae8ebfa98a3d45181fb248072a2afac`).
The maintained deltas below include one documented public-barrel compatibility
export inside `vendor/pi`; the remaining product adapters live outside the
vendored tree.

## Maintained deltas

| Area | Maintained adapter | Why it survives v0.84.3 | Contract test |
| --- | --- | --- | --- |
| Host Protocol | Electron utility-process JSONL bridge around Pi Core | Upstream provides server/client packages, but not this product's Electron lifecycle and renderer boundary. | `smoke-pi-host-protocol.mts`, `smoke-pi-host-supervisor.mts` |
| Session binding | Host-owned session files and renderer-thread binding | Upstream session backends do not own this product's durable thread-to-session mapping and restart projection. | `smoke-pi-session-binding.mts`, `smoke-pi-session-restart.mts` |
| Tool policy | Pi active-tools, approval, and audit projection | Upstream tool execution does not replace this product's unattended-run admission and approval evidence contracts. | `smoke-pi-all-origin-policy-contract.mts`, `smoke-pi-file-approval-audit.mts` |
| Public compatibility surface | Re-export `PACKAGE_NAME` and `AuthStorage` from the coding-agent barrel | AgentStudio resolves subscription identity and creates Host-owned auth storage through Pi's public entry instead of reaching into private source paths. | `smoke-pi-core-vendor.mts` |

## Gate rule

No undocumented core edits. A synchronization change must either remove a
delta that upstream now supplies or add a row with its rationale and a test.
