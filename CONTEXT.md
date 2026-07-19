# SubAgents AI

An Electron desktop app (`app/`) that runs an agent loop (Turn/Goal/Time-based/Proactive) over local tools, capabilities, and CLI providers. This context covers the whole product; SubDesign and OpenDesign are workflows within it, not separate products.

## Language

**Design System**:
The canonical, project-owned brand/token contract for a project — a project-relative `DESIGN.md` (plus optional `tokens.css`, `assets/`) living at the project root or under `.subagents/subdesign/design-systems/<id>/`. This is the only form the SubDesign build/critique loop actually reads when generating or scoring artifacts.
_Avoid_: "design system pack", "system" alone when the project-owned form is meant.

**Design System Pack**:
A read-only OpenDesign vendor content record (`OpenDesignCatalogRecord`/`OpenDesignContentPackManifest` with `kind: 'design-system'`) sitting in the local catalog under `app/public/open-design/`. It is inert catalog metadata until explicitly installed/copied into a project, at which point it becomes a **Design System**.
_Avoid_: "design system" alone when referring to vendor/catalog content — this distinction was previously conflated in the codebase (no install path connected the two).

**SubDesign**:
The in-app design task workflow (brief → direction → build → critique → deliver) that runs on the same agent lifecycle (`runTask`) as every other task in the product. Not a separate app or runtime.
_Avoid_: "Open Design" (that's the upstream vendor product SubDesign draws concepts/content from, not this feature).

**OpenDesign** (in this codebase, `agent/openDesign/*`):
The read-only indexer/pack-installer for vendored Open Design content (templates, skills, design system packs) bundled under `app/public/open-design/`. A content source, not a runtime — it never executes agent turns itself.
_Avoid_: "Open Design" (capital, two words) when referring to this in-repo indexing layer — reserve that spelling for the external upstream product being vendored from.

**Chat turn**:
One message the user sends from the composer. Owns busy policy (steer/queue), the chat bubble, and thread continuity — but is not itself the unit that parses/executes.
_Avoid_: using "turn" interchangeably with "Loop run" — a single chat turn can dispatch a Turn-based, Goal-based, Time-based, or Proactive loop run underneath it; they are different layers (see `docs/CONVERSATION_LOOP_HERMES_FLOW.md` §5.2).

**Loop run**:
One `agentEngine.start()` invocation (or one external CLI execution) — the unit that actually Parses (builtin only), picks a Loop Pattern (Turn/Goal/Time/Proactive per `docs/02_Execution_Rules`), executes steps, and evaluates DoD (builtin only). Default product behavior is **one run at a time**; with `concurrentRunsEnabled` (opt-in, ADR-0003) multiple loop runs may be in flight up to `maxConcurrentRuns`, each still 1:1 with the chat turn / automation tick that started it and isolated by `runId`.
_Avoid_: "run" alone when the distinction from "chat turn" matters — spell out which layer.
_Avoid_: describing concurrency as always-on global multi-run — default remains single-run until the user opts in.

**Task run (coordinator)**:
One `taskRunCoordinator.runTask` admission — capacity reserve, attachment prepare, thread bind, beforeRun, dispatch snapshot, and single finalization. Every product entry (composer, slash, schedule, webhook, telegram, delegate) must enter here.
_Avoid_: calling `dispatchThreadTask` or `startExecution` from UI pages.

**Time-based / Proactive trigger**:
Time-based requires a claimed ScheduledJob snapshot; Proactive requires event-matcher evidence. Conversation keywords alone never execute these modes (consent-first automation suggestion only).
_Avoid_: treating "每天 08:00 …" in chat as an automatic scheduled run.

**External CLI run**:
`executionKind: 'external'` via local CLI providers. Declares no parse/DoD/iterate/continueGoal/progressive capabilities until a verified prompt contract is enabled (`agent/runners/`).
_Avoid_: treating CLI success as Definition of Done met.

**Approval Mode（核准模式）**:
The per-run authority posture selected as `要求核准` (`always`), `代我核准` (`auto`), or `完整存取權` (`full`). Settings owns the default; the composer may override it for one task run. It is independent from Loop Pattern: Goal-based controls iteration, while Approval Mode controls whether side effects require human approval. Plan mode, explicit deny rules, capability-required approval, and unattended downgrade remain stronger constraints.
_Avoid_: calling this "control policy" in user-facing copy — that term also covers organization rules, unattended behavior, and release boundaries.

**Free Core**:
The no-cost, closed-source desktop product baseline. It includes a useful local coding-agent workspace comparable to the open-market baseline: local CLI/provider connections, projects/sessions, basic multi-agent use, permissions, Plan/Goal tasks, skills/MCP, diff/terminal/history, export, and Handoff. Free means no subscription entitlement is required; it does not mean open source.
_Avoid_: gating basic provider access, MCP, diff, or all multi-agent use behind subscription — paid value is advanced orchestration and reliability.

**Subscription Feature Pack**:
A versioned, signed optional capability/workflow package downloaded only after a subscription entitlement is verified. The free core owns updates and security fixes; the pack owns paid orchestration such as Spec → Tickets → TDD → Review, unattended automation, advanced quality gates, and long-term artifact analytics. Losing entitlement must not make existing user data unreadable or unexportable.
_Avoid_: shipping separate diverging Free and Pro application binaries.

**Artifact Index**:
A local index of the specs, tickets, diffs, test evidence, reviews, decisions, and output artifacts produced by a task. It records references and compact metadata rather than duplicating every artifact. It is the source used to assemble an optional Handoff Package.
_Avoid_: treating the index as cloud sync or silently uploading indexed content.

**Handoff Package**:
A user-requested portable document generated from the Artifact Index for another session, agent, or person. The entry point belongs in the composer `+` menu. Generation and delivery are separate: the first product version creates a local file only and never sends or uploads it automatically.
_Avoid_: generating a second copy of existing specs/plans/diffs; reference those artifacts by path or URL.
