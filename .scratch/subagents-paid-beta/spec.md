# SubAgents AI Paid Beta Productization

Status: approved

## Problem Statement

SubAgents AI already provides a substantial Local-first agent workspace: multiple Loop Patterns, cross-provider CLI runners, capabilities, permissions, MCP, skills, automations, queueing, delegation, worktree support, rewind, diff summaries, and local history. However, the product is not yet ready for external paid use on Windows and macOS.

From a user's perspective, the gap is not merely missing agent features. A user cannot yet rely on a signed and notarized release, install it on a clean machine, recover an interrupted run after a crash, update safely, activate a subscription, download a verified Subscription Feature Pack, or understand the privacy and support contract of a closed-source product. The existing source-level build and smoke suite proves core engineering behavior, but it does not prove a trustworthy paid desktop product.

The target is a paid Beta for individual power developers and 3–20 person teams. The product is closed source, Local-first, formally supports Windows 10/11 and macOS, and uses a free core plus subscription feature packs. The target price hypothesis is US$9/month or US$90/year, with no token or task metering.

## Solution

Deliver a signed, notarized, recoverable, updateable Local-first desktop product with a useful Free Core and a subscription boundary for advanced orchestration.

The Free Core remains useful without login and includes the baseline coding-agent workspace: local provider/CLI connections, projects and sessions, basic multi-agent use, Plan and Goal tasks, permissions, skills/MCP, diff/terminal/history, export, and Handoff. Subscription does not gate basic provider access or all multi-agent use.

The subscription unlocks versioned, signed Subscription Feature Packs containing advanced orchestration and reliability features: Spec → Tickets → TDD → Review, unattended automation, recovery and quality gates, Artifact Index analytics, and future professional workflow packs. Existing local data remains readable and exportable after cancellation.

The primary paid workflow is:

```text
Spec → Tickets → TDD → Review → Artifact Index → user-selected Handoff
```

Handoff generation is user initiated from the composer `+` menu. It creates a local portable document; delivery and upload are separate user actions.

## User Stories

### Product access and platform

1. As an individual developer, I want to download the Free Core without creating an account, so that I can evaluate the local coding workspace before subscribing.
2. As a Windows user, I want an installer signed by a trusted publisher, so that the operating system does not present an avoidable trust warning.
3. As a macOS user, I want a notarized application that passes Gatekeeper, so that I can install and launch it normally.
4. As a user, I want Windows 10/11 and macOS to be formal supported platforms, so that platform support is an explicit product promise.
5. As a user, I want the app to check for signed updates, so that security fixes do not depend on manually finding a new installer.
6. As a user, I want an update to preserve my threads, settings, projects, queue, schedules, and vault metadata, so that updating does not reset my workspace.
7. As a user, I want a failed update to recover or roll back safely, so that a bad release cannot strand my installation.
8. As a maintainer, I want each release to have immutable artifacts, checksums, SBOM, provenance, and a release report, so that a binary can be verified after publication.

### First-run and local coding workspace

9. As a first-time user, I want a guided setup that checks Git and supported CLI providers, so that I can reach a first successful task without reading internal documentation.
10. As a first-time user, I want missing CLI or PATH problems explained with repair guidance, so that discovery failures are actionable.
11. As a user, I want the Free Core to connect to Codex, Claude Code, OpenCode, and other supported local providers, so that the product remains vendor-neutral.
12. As a user, I want to use projects, sessions, terminal output, basic diff, permissions, skills, and MCP without a subscription, so that the free product is a credible OpenCode-level baseline.
13. As a user, I want to choose between Turn-based and Goal-based tasks, so that a one-shot request does not unexpectedly become an autonomous workflow.
14. As a user, I want Time-based and Proactive runs to require their validated trigger evidence, so that conversational wording cannot silently create background execution.
15. As a user, I want the app to preserve the current run/thread identity across concurrent work, so that one agent cannot cancel or display another agent's activity.
16. As a user, I want worktree isolation to be visible and reviewable, so that I know whether a delegated change is isolated or in the main workspace.
17. As a user, I want an isolation failure to be explicit rather than silently falling back to a shared workspace, so that I can make an informed safety decision.

### Approval and safety

18. As a user, I want a global default Approval Mode, so that my normal safety posture is consistent.
19. As a user, I want to override Approval Mode in the composer for one task, so that a trusted task does not require changing global settings.
20. As a user, I want `要求核准`, `代我核准`, and `完整存取權` to have clear descriptions, so that I understand their effect before running a task.
21. As a user, I want Plan mode, deny rules, capability-required approval, and unattended downgrades to remain stronger constraints, so that a permissive mode cannot bypass safety boundaries.
22. As a user, I want secrets to stay in the main-process vault and never appear as raw renderer data, so that provider credentials remain protected.
23. As a user, I want the app to refuse or clearly warn when OS secure storage is unavailable, so that secrets are not silently stored in plaintext.
24. As a user, I want to see what network endpoints and telemetry fields are used, so that I can make an informed privacy decision.
25. As a user, I want export to redact secrets and explain sensitive metadata, so that a backup or Handoff cannot accidentally disclose credentials.

### Run durability and recovery

26. As a user, I want an interrupted run to be marked `interrupted` after a crash or forced close, so that it is not displayed as permanently running or successful.
27. As a user, I want queued work to resume at most once after restart, so that recovery cannot duplicate work.
28. As a user, I want a once-job to remain exactly-once across a crash, so that automation cannot publish or mutate external state twice.
29. As a user, I want corrupted local state to be backed up, quarantined, or restored from a last-known-good copy, so that it cannot silently erase my visible history.
30. As a user, I want a recovery report after restart, so that I know what was resumed, skipped, or requires my action.

### Subscription and feature packs

31. As a user, I want to subscribe for a predictable fixed seat price, so that my SubAgents AI bill does not vary with tokens or task count.
32. As a user, I want monthly and annual Pro options, so that I can choose a commitment level.
33. As a subscriber, I want to activate my entitlement on a small number of devices, so that I can use the product across my own machines.
34. As a subscriber, I want a reasonable offline grace period, so that a temporary network outage does not disable local work.
35. As a subscriber, I want a cancelled subscription to stop future paid downloads without making existing local data unreadable, so that cancellation is reversible and respectful.
36. As a subscriber, I want a paid feature pack to be signature and hash verified before loading, so that a compromised download cannot silently add privileged behavior.
37. As a subscriber, I want a failed feature-pack update to roll back, so that the Free Core remains launchable.
38. As a maintainer, I want one entitlement boundary to govern every paid feature, so that subscription checks cannot drift across UI and runtime paths.

### Paid workflow and handoff

39. As a subscriber, I want to submit a development objective and receive a proposed Spec, so that ambiguity is surfaced before execution.
40. As a subscriber, I want the approved Spec to become traceable Tickets, so that each change has an explicit unit of work.
41. As a subscriber, I want each Ticket to drive TDD evidence, so that implementation is tied to a testable acceptance contract.
42. As a subscriber, I want agents to review changes and attempt bounded fixes when tests or review fail, so that routine correction does not require manual orchestration.
43. As a user, I want the final result to remain user-approved before merge, push, or deploy, so that autonomous execution does not become unauthorized release.
44. As a user, I want an Artifact Index to reference specs, tickets, diffs, tests, reviews, decisions, and output artifacts, so that the whole task remains auditable without duplicating content.
45. As a user, I want a `+` menu option to create a Handoff Package, so that I can decide when a task is ready to pass to another session, agent, or person.
46. As a user, I want Handoff generation to create a local file without automatic upload, so that Local-first remains true.
47. As a user, I want Handoff files to reference existing artifacts rather than copy every large transcript, so that the package stays compact and avoids conflicting duplicates.

### Product trust and operations

48. As a user, I want a product website explaining the Free Core, Pro subscription, supported platforms, download links, and checkout, so that I can understand and buy the product without private assistance.
49. As a user, I want public EULA, terms, privacy, retention, deletion, and refund policies, so that the closed-source product has a clear operating contract.
50. As a user, I want a Local-first security whitepaper and data-flow description, so that I can evaluate the product without source-code access.
51. As a user, I want version, license, network, telemetry, and local-data controls visible in the app, so that important trust settings are discoverable.
52. As a maintainer, I want crash, update, subscription, and support events to be diagnosable without collecting raw prompts or source code, so that operations can improve the product without violating the product promise.
53. As a maintainer, I want a Go/No-Go release qualification that uses signed packaged artifacts, so that passing source-level smoke tests cannot be mistaken for paid-product readiness.

## Implementation Decisions

- Keep `taskRunCoordinator.runTask` as the highest execution seam and preserve the existing run-scoped lifecycle ownership.
- Keep Loop Pattern, Approval Mode, entitlement, and release policy as separate domain concepts.
- Keep a single Free Core application identity; do not maintain diverging Free and Pro binaries.
- Resolve paid access through one entitlement boundary consumed by UI, runtime, and feature-pack installation.
- Treat Subscription Feature Packs as versioned, signed, hash-verified packages with compatibility metadata and rollback.
- Keep Free Core useful without login and without a subscription.
- Store local Artifact Index and Handoff data locally; generation and delivery remain separate actions.
- Expose Approval Mode in the composer as a per-run override over the Settings default.
- Use the existing coordinator, run queue, thread persistence, vault, capability, plugin, worktree, rewind, and smoke seams before introducing new cross-cutting abstractions.
- Add durable run journaling and startup reconciliation at the coordinator boundary rather than teaching every runner how to recover itself.
- Treat signed native packaging, install/upgrade/recovery evidence, and release metadata as product contracts, not optional CI decoration.
- Keep Windows 10/11 and macOS as formal supported platforms; the release matrix must cover the chosen Intel and Apple Silicon strategy explicitly.
- Closed-source distribution requires public security, privacy, retention, deletion, EULA, terms, and refund documents.
- No raw prompts, source files, credentials, or full transcripts are required for operational telemetry; any telemetry must be documented and consented.
- No new model provider billing is introduced; users continue to bring their existing CLI or provider account.

## Testing Decisions

- Tests assert external behavior at the highest available seam. They should not pin private helper names, comment order, or implementation-specific call counts.
- Release tests use real signed packaged artifacts, not only Vite output or source imports.
- The release evidence seam verifies platform matrix, immutable artifacts, checksum/SBOM/provenance, and required CI status.
- The install seam verifies clean install, launch, preload/IPC contract, first-run CLI doctor, core task, restart persistence, uninstall, and N-1→N upgrade.
- The recovery seam verifies forced renderer/main termination, interrupted-run reconciliation, queue exactly-once behavior, scheduler once-job behavior, and corrupted-state restore/quarantine.
- The entitlement seam verifies Free, active Pro, expired Pro, offline grace, cancelled subscription, device limits, and feature-pack denial without network access.
- The feature-pack seam verifies manifest compatibility, signature/hash validation, installation, activation, rollback, and preserving Free Core launchability.
- The workflow seam verifies Spec → Tickets → TDD → Review, bounded correction, final user approval, Artifact Index references, and local Handoff creation.
- The security seam verifies production CSP, navigation/permission allowlists, secure-storage-unavailable behavior, redacted exports, documented telemetry, and dependency/secret scanning.
- Existing smoke scripts, real production-module tests, scenario E2E, and build/lint checks remain prior art. Packaged Electron E2E and clean-machine release tests are required additions.
- A paid Beta is Go only when every P0 acceptance criterion has stored evidence from the signed release artifact; build and source smoke alone are insufficient.

## Out of Scope

- Replacing Codex, Claude Code, or OpenCode models.
- Charging for model tokens, task count, or agent count.
- Making the product open source.
- Requiring cloud storage or uploading source code, prompts, transcripts, or Handoff files.
- Mobile remote control, managed cloud coding environments, SSH coding sessions, or remote worker execution for the first paid Beta.
- Enterprise SSO, SCIM, RBAC, compliance API, centralized team audit, and organization-wide managed policies.
- Full parity with every Codex or Claude Desktop editor, PR, computer-use, or cloud feature.
- Automatic merge, push, deploy, or Handoff delivery without user selection.
- Separate Free and Pro application binaries.

## Further Notes

- OpenCode establishes the free baseline: its official product is open source and advertises multi-provider access, desktop/TUI/IDE surfaces, multi-session use, Plan/Build agents, skills, plugins, and MCP. Free Core must therefore be useful before subscription.
- Codex is strongest in desktop worktrees, review, scheduled tasks, skills/plugins/MCP, and enterprise controls.
- Claude Desktop Code is strongest in per-session Git isolation, visual diff/line review, remote environments, PR/CI monitoring, and desktop auto-update.
- SubAgents AI should sell the cross-provider control plane, advanced workflow automation, artifact traceability, and recovery—not basic access to a coding agent.
- The product website is a required delivery item, not a later marketing embellishment. It must be complete enough to explain the product, download the correct platform build, compare Free/Pro, purchase, and link to trust documents.
