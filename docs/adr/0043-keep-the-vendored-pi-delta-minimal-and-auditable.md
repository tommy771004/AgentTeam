# Keep the vendored Pi delta minimal and auditable

SubAgents behavior is implemented through Extension Packs and adapters unless Pi Core lacks a necessary stable hook or Host API. Every change under `vendor/pi` must be listed in a Core Patch Ledger with its upstream base, rationale, affected contract, tests, and upstream status, keeping the project-owned fork synchronizable instead of allowing product features to accumulate invisibly inside the four core packages.
