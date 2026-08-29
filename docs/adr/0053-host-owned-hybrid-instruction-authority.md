# Host-owned hybrid instruction authority

Date: 2026-08-29

Status: Accepted

## Context

AgentStudio previously had three instruction-like owners: flat renderer settings, Learning's SOUL/internal AGENTS prompt, and renderer filesystem discovery for real project AGENTS/CLAUDE files. Their names overlapped and no durable fact identified what a Task run actually sent to the model. Putting all content in DurableMemoryStore would erase the distinction between explicit policy and learned memory, while copying project files into SQLite would break Git, worktree, IDE and native CLI semantics.

## Decision

Global custom instructions, advanced personality text and migrated personalization metadata belong to a dedicated Host-only Instruction Repository. Production uses its own `instructions.sqlite` database and WAL lifecycle. It shares neither tables nor protocol methods with DurableMemoryStore. An in-memory adapter implements the same public asynchronous contract for deterministic qualification.

Project instructions remain filesystem-owned. Pi Host is the production discovery and include-resolution owner. It canonicalizes paths before scope checks, selects directory overrides deterministically, bounds fallback names and local includes, preserves transitive provenance, and performs project writes only through canonical-target CAS plus atomic replacement. Renderer discovery survives only as a plain-browser compatibility fallback.

The one Task-run admission freezes a resolved instruction snapshot. Global instructions assemble first, increasingly specific project instructions follow, and the current request is placed last for salience. Authority is distinct from assembly order: managed policy and runtime safety remain higher than every user-editable instruction; nearer project rules outrank broader project and global defaults; learned memory remains lower.

Every builtin run appends a Host-authored `instruction-snapshot` Turn Record entry containing the exact bounded effective text, source hashes, diagnostics, usage and delivery evidence. Loop iterations reuse that immutable object. A later repository or filesystem change affects only the next admission. External runners disclose `explicit`, `native`, or `unverified` delivery and never claim builtin-equivalent snapshot fidelity without evidence.

## Consequences

- A committed repository revision is acknowledged only after its transaction commits; CAS prevents stale renderer writes.
- Historical replay reconstructs model-visible instructions without reading current SQLite rows or files.
- Temporary chats retain explicit global/project instructions while durable-memory access stays disabled.
- Instruction content still crosses the existing Outbound Data Gate and cannot alter Approval Mode, capabilities, sandbox policy, managed policy or execution evidence.
- Export/import includes only DB-owned records. Project file bodies are never smuggled into the personalization bundle.
- Protocol and drift guards must keep Instruction Repository and DurableMemoryStore as visibly separate authorities.
