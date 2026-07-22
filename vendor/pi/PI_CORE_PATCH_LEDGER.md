# Core Patch Ledger

This file is the review ledger for the vendored Pi Core revision recorded in
`PI_UPSTREAM_PIN.json`. A synchronization change must update the pin first,
then reconcile every intentional delta here. The sync gate rejects a vendor
tree whose recorded hash no longer matches the pin.

## Maintained deltas

| Area | Patch | Rationale | Contract test |
| --- | --- | --- | --- |
| Host Protocol | Electron utility-process JSONL bridge around Pi Core | Keep the renderer/UI boundary stable while Pi remains the durable runtime owner. | `smoke-pi-host-protocol.mts`, `smoke-pi-host-supervisor.mts` |
| SessionManager | Host-owned session files and renderer-thread binding | Preserve conversations across restart without making renderer storage canonical. | `smoke-pi-session-binding.mts`, `smoke-pi-session-restart.mts` |
| Tool policy | Pi active-tools and approval projection | Make tool access explicit and safe for unattended automation. | `smoke-pi-policy.mts`, `smoke-pi-equivalent-tools.mts` |

## Gate rule

No undocumented core edits. A synchronization change must either remove a
delta that upstream now supplies or add a row with its rationale and a test.
