# AgentStudio

An Electron desktop app (`app/`) running an agent loop (Turn/Goal/Time-based/Proactive) over local tools, capabilities, and CLI providers. SubDesign and OpenDesign are workflows within it, not separate products.

Shared vocabulary. The `_Avoid_` lines record wording that has actually caused confusion — they carry more weight than the definitions.

## Execution layers

**Chat turn** — one composer message, owning busy policy (steer/queue), the bubble, and thread continuity. It is not the unit that parses or executes: that is the **Loop run** beneath it — one engine invocation (or one external CLI execution) that Parses (builtin only), picks a Loop Pattern per `docs/02_Execution_Rules`, executes steps, and evaluates DoD (builtin only). Different conversation threads execute independently up to `maxConcurrentRuns`; same-thread follow-ups remain ordered, and every run stays 1:1 with the chat turn or automation tick that started it and isolated by `runId`.
_Avoid_: using "turn" and "run" interchangeably, or describing concurrency as always-on.

**Task run (coordinator)** — one `taskRunCoordinator.runTask` admission: capacity reserve, attachment prepare, thread bind, beforeRun, dispatch snapshot, single finalization. Every entry (composer, slash, schedule, webhook, telegram, delegate) enters here.
_Avoid_: calling `dispatchThreadTask` or `startExecution` from UI pages.

**Goal Contract（目標契約）** — an immutable, Host-validated and digested snapshot binding a Goal-based Task run to executable acceptance criteria, budgets, constraints, outputs, and escalation policy before its first provider call. Free-form Definition of Done text remains a display/rubric source until a registered checker mapping makes it executable; a Goal run with no executable criterion is `unverifiable`, not successful because the assistant answered.
_Avoid_: model-authored success claims, arbitrary shell commands as criteria, or treating prose acceptance criteria as executable evidence.

**Pi Core tool loop（Pi Core 工具迴圈）** — the production execution core is Pi Core in the supervised Electron utility process: tool loop, tool approval, step settlement, host-side execution evidence. `agentEngine` / `runDispatch` adapt the coordinator snapshot to it; external CLI is a separate runner contract. Renderer `agent/loop/` exists only for plain-browser compatibility until the ADR-0045 deletion gate is met.
_Avoid_: describing `agent/loop/` as the production owner or adding imports to it — new lifecycle behavior belongs behind `taskRunCoordinator`.

**Time-based / Proactive trigger** — Time-based requires a claimed ScheduledJob snapshot, Proactive requires event-matcher evidence. The claim is a typed, required part of the loop request asserted fail-closed at one admission point, so an evidence-less request is unrepresentable at the type level.
_Avoid_: treating "每天 08:00 …" in chat as a scheduled run, or re-verifying triggers at scattered call sites.

**External CLI run** — `executionKind: 'external'` via local CLI providers. No builtin parse/DoD/iterate/progressive capabilities; `continueGoal` works only through the explicit prompt contract in `agent/runners/`.
_Avoid_: treating CLI success as Definition of Done met.

**Execution evidence（執行證據）** — the model cannot manufacture it. Model text, tool arguments, planned state, and claimed success are not proof a side effect occurred; only the trusted adapter that performed the effect may issue a non-model snapshot, and missing or model-attested evidence makes the result unsuccessful (ADR-0048). Automatic retry after recovery needs a replay-safe checkpoint proving nothing effectful happened since it.

**Run Review Snapshot（執行審查快照）** — an immutable, Host-owned record of the code changes associated with one Task run, bound to a workspace baseline, settlement identity, integrity hashes and stated attribution fidelity. Historical review reads this artifact and never reinterprets the current working tree as an older run.
_Avoid_: saved diff, last-turn working-tree diff, treating a renderer string as historical truth.

**Live Workspace Diff（即時工作目錄差異）** — a mutable view of one workspace revision and Git scope, refreshed from the current checkout. It is useful for current review and Git actions but is never a fallback for a missing Run Review Snapshot.
_Avoid_: run diff, historical review, silently presenting live state as archived state.

**Change attribution fidelity（變更歸屬可信度）** — the Host-stated strength of the relationship between workspace changes and one Task run: exact in an uncontaminated isolated worktree, attributed by trusted side-effect evidence, shared in a checkout with other writers, or partial when coverage is incomplete.
_Avoid_: inferring ownership from model text, tool arguments, touched-file guesses or CLI success.

## Pi platform

**Pi Core（Pi 核心）** — the project-owned vendored foundation from `pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, owning model access, agent/session execution, the extension host, and terminal primitives. The Electron/React app is the desktop shell; the Pi CLI and TUI are not product entry points. **Pi Core Host** is the Electron utility process owning those runtimes behind the versioned Pi Host Protocol.
_Avoid_: treating Pi as an external CLI provider; terminal-output scraping; Node-only Pi code in the renderer; undocumented `vendor/pi` edits (those belong in the Core Patch Ledger).

**UI Projection（UI 投影）** — the disposable renderer view of Host session and run state, rebuilt from a snapshot plus events after a cursor. Zustand may cache it for presentation but never becomes an authority that overwrites newer Host state; an archived Host session is a tombstone it must not resurrect.
_Avoid_: calling renderer localStorage the session store, or two-way canonical-state sync.

**Trusted Extension（受信任擴充）** — a Pi-compatible extension loaded as local application code with the app's full filesystem, process, network, environment, and credential authority. Enabling one is an explicit trust decision, not a sandbox grant. Cohesive boundaries (Orchestration, Policy, Capabilities, Memory, Automation, Integrations, Marketplace) are **Extension Packs**.
_Avoid_: "safe plugin", or implying marketplace origin limits runtime authority.

## Approval

**Approval Mode（核准模式）** — the per-run authority posture: `要求核准` (`always`), `代我核准` (`auto`), `完整存取權` (`full`). Settings owns the default, the composer may override it for one run. Independent from Loop Pattern: Goal-based controls iteration, Approval Mode controls whether side effects need approval.
_Avoid_: calling this "control policy" in user-facing copy.

**Approval Decision（核准決策）** — the single composed verdict (allow / deny / ask, plus its observability events) for one tool invocation, produced by evaluating every authority layer in a fixed order. The order is part of the meaning: a hook deny wins over everything, and capability-required approval survives `完整存取權`.
_Avoid_: "permission check" or "guard" for the composed verdict; Approval Mode is one input, never a synonym.

_Avoid_: calling builtin shell sandboxed because the CLI path is — ADR-0022 isolates external CLI, ADR-0047 keeps builtin `bash` fail-closed under Outbound Guard `required`.

## Outbound protection

**Outbound Data Gate（出站資料閘門）** — the policy-controlled boundary deciding whether information may leave the app for an LLM or external CLI. Effective mode derives from deployment policy plus user setting; only an effective `off` bypasses inspection, and mandatory company protection cannot be weakened by the user.
_Avoid_: "secret filter" or `beforeRun` hook — neither expresses the boundary or its fail-closed guarantee.

**Protected Data（受保護資料）** — content classified company-confidential or personal, excluded from AI runners whenever protection is active, whatever its origin (file, prompt, history, tool result, attachment). The **Sanitized Workspace** is the temporary per-provider view a runner actually sees: protected content is *absent*, not merely omitted from the first prompt, and views are never shared across providers or written back over the source.
_Avoid_: "secret" alone (credentials are one subset), or "prompt filtering" / "temporary copy" — the point is a boundary that holds after execution starts.

## Naming traps

**SubDesign** is the in-app design workflow (brief → direction → build → critique → deliver) on the same `runTask` lifecycle as every other task; **OpenDesign** (`agent/openDesign/*`) is the read-only indexer for vendored content, never a runtime. The former **Design System** feature (project-owned `DESIGN.md` contract, picker, and `design_system_*` tools) was removed on 2026-08-22; references to it are historical.
_Avoid_: "Open Design" (capital, two words) for the in-repo layer; that spelling is the upstream product.
