# Run review snapshots are immutable Host artifacts

Date: 2026-08-30

Status: Accepted

## Context

The existing run summary asks the current working tree for a bounded diff at settlement. Re-reading a mutable checkout is convenient, but it cannot preserve historical truth after later edits or commits and cannot honestly attribute changes when users, parallel runs or external CLIs share a checkout. Keeping complete patches in renderer state or the Turn Record would also create a second authority and make large reviews unbounded.

## Decision

A **Run Review Snapshot** is an immutable, Host-owned artifact bound to one Task run, workspace identity, baseline, settlement identity, content hashes and explicit attribution fidelity. The Host stores and verifies its metadata and paged payload; the Turn Record, thread summary and Archive retain only bounded identity references needed for replay and audit.

A **Live Workspace Diff** is a separate mutable review target. Historical snapshot reads never fall back to the live workspace, and live refresh never mutates a snapshot. Shared-checkout or external-CLI captures downgrade to `shared` or `partial` unless a trusted Host adapter can prove exact attribution. Git writes accept only mutable targets and pass through a revision-CAS, approval-controlled mutation coordinator.

## Consequences

- Historical Review remains stable after commit, restart and later runs.
- Large patches are served per file/hunk instead of truncated into renderer state.
- Exact per-run attribution may require an isolated worktree; shared checkouts are disclosed rather than guessed.
- Review artifacts need their own SQLite lifecycle, recovery, export/import and retention policy.
- `ThreadRunSummary.diff` remains compatibility data only and cannot become the canonical review source.
