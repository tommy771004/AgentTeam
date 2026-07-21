---
status: accepted
---

# Validate policy drafts before activation

Policy Admin Build never edits an active Company Base Policy, Provider Supplemental Policy, or Policy Bundle in place. Changes move through draft, schema and identity validation, monotonic-tightening validation, and synthetic detector fixtures before explicit activation or publication. Local source atomically replaces the active files; Workspace source publishes a new bundle version. Failed validation or activation leaves last-known-good active, and a `required` run already in progress keeps its pinned version.

Rollback also validates and activates a new monotonically increasing version whose metadata identifies the faulty version and the previously valid content it restores; active version numbers never move backward. Every activation and rollback appends a structured event to the single Security Evidence Ledger describing reason, rule IDs, changed field names, and rollback relationships without copying policy-sensitive values. Complete versions remain in the policy store for recovery.
