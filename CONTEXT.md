# SubAgents AI

An Electron desktop app (`app/`) that runs an agent loop (Turn/Goal/Time-based/Proactive) over local tools, capabilities, and CLI providers. This context covers the whole product; SubDesign and OpenDesign are workflows within it, not separate products.

## Language

**Pi Core（Pi 核心）**:
The project-owned, vendored foundation derived from Pi's four packages: `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-tui`. It owns model access, agent/session execution, the extension host, and terminal primitives while the Electron/React app remains the desktop product shell; the Pi CLI application and interactive TUI mode are not product entry points.
_Avoid_: treating Pi as an external CLI provider, replacing the Electron interface with Pi's terminal UI, or excluding the `pi-coding-agent` SDK merely because its CLI entry point is excluded.

**SubAgents Extension（SubAgents 擴充）**:
A product capability attached through the Pi Core extension boundary, primarily the `pi-coding-agent` extension host. It may consume lower-level Pi services through that host; it is not a separate plugin system independently mounted into each of the four Pi packages.
_Avoid_: saying every Pi package has its own extension host, or using "extension" for code that must remain part of the trusted security boundary.

**Trusted Extension（受信任擴充）**:
A Pi-compatible extension loaded as local application code with the same filesystem, process, network, environment, and credential authority as SubAgents AI. Installing or enabling one is an explicit trust decision, not a sandbox grant.
_Avoid_: "safe plugin", "restricted plugin", or implying that signature or marketplace origin limits its runtime authority.

**Pi Settings（Pi 設定）**:
The canonical runtime configuration owned by Pi Core and edited through the SubAgents AI settings UI. A SubAgents-only setting may remain outside it only when it expresses a desktop product concern that Pi does not model.
_Avoid_: mirroring provider, model, thinking, tool, compaction, or session settings into a second `LlmSettings` source of truth.

**Orchestration Extension（編排擴充）**:
The trusted SubAgents Extension that preserves the Turn-based, Goal-based, Time-based, and Proactive Loop Patterns while delegating each agent turn and tool loop to Pi Core. A SubAgents thread owns a durable Pi session; a Task run is one `runId`-scoped orchestration over that session.
_Avoid_: implementing a second agent/tool loop beside Pi Core, equating a Pi turn with a complete Task run, or creating a fresh Pi session for every run.

**Equivalent Tool（等價工具）**:
A Pi tool that matches a legacy SubAgents tool's user-visible contract across parameters, results, streaming updates, cancellation, project scope, and session recording. Only an Equivalent Tool may replace and cause removal of its legacy implementation.
_Avoid_: declaring tools equivalent from a shared name or happy-path output alone.

**Capability Extension（能力擴充）**:
The trusted SubAgents Extension that progressively reveals runbooks and controls which Pi tools are active for a session. Pi Core remains the only tool loop; the extension does not maintain a parallel registry, executor, or invocation lifecycle.
_Avoid_: a second capability runtime wrapped around Pi's tool loop, or exposing every installed tool schema on every turn.

**CodeMode（程式編排模式）**:
A Capability Extension tool that runs model-generated JavaScript in an isolated worker solely to coordinate currently active Pi tools. The generated program has no direct Node, filesystem, process, or network authority, and every nested tool call remains individually observable and cancellable.
_Avoid_: equating model-generated code with Trusted Extension code or granting it the host process's authority.

**Effective Agent Profile（有效 Agent 設定檔）**:
The immutable per-agent configuration compiled from Pi Settings, the selected SubAgents role, and the Task run override when a Task run is submitted or queued. It fixes that agent's model, thinking level, prompt, active tools, capability preload, and Approval Mode for the run; a later run in the same durable Pi session uses a new snapshot without rewriting prior history.
_Avoid_: having agents read mutable UI state during execution or sharing one unresolved settings object across different roles.

**Policy Extension（政策擴充）**:
The sole SubAgents authority that produces Approval Decisions and outbound-provider decisions for model activity through Pi's tool and provider hooks. Pi hooks are enforcement points for this policy, not a second permission system; direct host actions performed by Trusted Extensions remain outside this model-activity boundary.
_Avoid_: stacking independent Pi and SubAgents permission verdicts or claiming the Policy Extension sandboxes Trusted Extensions.

**Extension Pack（擴充包）**:
A cohesive, manifest-declared SubAgents Extension boundary such as Orchestration, Policy, Capabilities, Memory, Automation, Integrations, or Marketplace, including its runtime and desktop UI contributions. A pack exists only for product behavior Pi Core does not already provide equivalently.
_Avoid_: one monolithic SubAgents extension, one package per file or tool, or wrapping an Equivalent Tool merely to preserve a legacy implementation.

**Settings Registry（設定註冊表）**:
The typed catalog that binds Electron form controls to Pi Settings or an Extension Pack's settings namespace. Every user-editable value has product copy, a concrete control, defaults, constraints, and validation; complex settings may supply a dedicated React panel.
_Avoid_: raw JSON editors, internal setting keys as UI labels, or hand-maintaining every extension field inside one central settings page.

**Desktop Contribution（桌面貢獻）**:
An optional SubAgents manifest attached to an otherwise standard Pi extension to declare settings controls, React panels, navigation, or other Electron-only surfaces. Absence of this manifest never prevents the extension from loading through Pi's native Extension API.
_Avoid_: a wrapper required to execute Pi extensions or a fork of the Pi Extension API.

**Memory Extension（記憶擴充）**:
The Extension Pack that owns durable memory, learning, dream consolidation, and cross-session recall beyond Pi's native session history. It consumes Pi session events and contributes recalled context without owning a second history or compaction pipeline.
_Avoid_: using Hermes to duplicate Pi session persistence, transcript history, or compaction.

**Pi Core Host（Pi 核心主機）**:
The dedicated Electron utility process that owns Pi Core runtimes, sessions, extensions, tools, and streamed events behind a typed Electron IPC protocol. Electron main supervises this process and the React renderer is its client; neither invokes nor parses the Pi CLI.
_Avoid_: terminal-output scraping, importing Node-only Pi runtime code into the renderer, or treating the desktop UI as the agent runtime.

**Child Pi Session（子 Pi 工作階段）**:
An independently configured Pi session created by the Delegation Extension for one subagent, with its own Effective Agent Profile, tools, budget, context, and transcript. It receives an explicit Context Packet and returns a result summary to its parent rather than sharing the parent transcript.
_Avoid_: temporarily switching roles inside the parent session or copying the entire parent conversation into every subagent.

**Pi Host Protocol（Pi 主機協定）**:
The versioned, capability-negotiated request/event contract between the Electron clients and Pi Core Host for initialization, sessions, Task runs, streamed items, approvals, settings, steering, and cancellation. Its TypeScript types are generated from one schema version rather than duplicated across processes.
_Avoid_: ad hoc `ipcMain.handle()` contracts, exposing Pi Core classes across IPC, or using a localhost server for an exclusively local desktop boundary.

**UI Projection（UI 投影）**:
The disposable renderer view of Pi Host session and run state, reconstructed from a Host snapshot followed by events after a cursor. Zustand may cache this view for presentation but never becomes an authority that can overwrite newer Host state.
_Avoid_: calling renderer localStorage the session store or implementing two-way canonical-state synchronization.

**Automation Extension（自動化擴充）**:
The Extension Pack that durably owns queued Task runs, scheduled claims, external trigger evidence, and once-job settlement in the Pi Host journal. It assigns `runId` before admission and resumes unsettled work after Host restart, while the Orchestration Extension remains the only path into Pi sessions.
_Avoid_: an in-memory scheduler, invoking Pi AgentSession directly from webhook or timer callbacks, or using payload equality as the run identity.

**Replay-safe Checkpoint（可安全重播檢查點）**:
A durable Task run boundary that proves either no effectful action has occurred since it or every later action is idempotent under the recorded identity. Only an interrupted run with such proof may retry automatically after Pi Host recovery.
_Avoid_: assuming a logged tool start, model response, or process exit makes an unknown side effect safe to repeat.

**Core Patch Ledger（核心修補帳冊）**:
The reviewed inventory of every project-owned change inside vendored Pi Core, recording its upstream base, necessity, affected contract, parity tests, and upstream disposition. A Core patch exists only when an Extension Pack or adapter cannot supply a required stable hook.
_Avoid_: undocumented edits under `vendor/pi`, product features implemented directly in core, or treating the fork as detached from upstream.

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
One `agentEngine.start()` invocation (or one external CLI execution) — the unit that actually Parses (builtin only), picks a Loop Pattern (Turn/Goal/Time/Proactive per `docs/02_Execution_Rules`), executes steps, and evaluates DoD (builtin only). The Pi Core host is the sole production owner of the builtin tool loop; the renderer `agent/loop/` implementation is a removable browser-compatibility seam, not a second production architecture. Default product behavior is **one run at a time**; with `concurrentRunsEnabled` (opt-in, ADR-0003) multiple loop runs may be in flight up to `maxConcurrentRuns`, each still 1:1 with the chat turn / automation tick that started it and isolated by `runId`.
_Avoid_: "run" alone when the distinction from "chat turn" matters — spell out which layer.
_Avoid_: describing concurrency as always-on global multi-run — default remains single-run until the user opts in.

**Pi Core tool loop（Pi Core 工具迴圈）**:
The production execution core is Pi Core in the supervised Electron utility process. It owns the tool loop, tool approval, step settlement, and host-side execution evidence. `agentEngine`/`runDispatch` adapt the coordinator snapshot to Pi Core; external CLI runs remain a separate runner contract. The renderer `agent/loop/` code is retained only for plain-browser compatibility until the deletion gate in ADR-0045 is satisfied.
_Avoid_: describing `agent/loop/` as the production execution owner or adding new imports to it. New lifecycle behavior belongs behind `taskRunCoordinator` and the Pi Host protocol.

**Task run (coordinator)**:
One `taskRunCoordinator.runTask` admission — capacity reserve, attachment prepare, thread bind, beforeRun, dispatch snapshot, and single finalization. Every product entry (composer, slash, schedule, webhook, telegram, delegate) must enter here.
_Avoid_: calling `dispatchThreadTask` or `startExecution` from UI pages.

**Time-based / Proactive trigger**:
Time-based requires a claimed ScheduledJob snapshot; Proactive requires event-matcher evidence. Conversation keywords alone never execute these modes (consent-first automation suggestion only). The claim/evidence travels as a typed, required part of the loop request and is asserted fail-closed at the Loop Runner's single admission point — an evidence-less Time/Proactive request is unrepresentable at the type level and refused at runtime.
_Avoid_: treating "每天 08:00 …" in chat as an automatic scheduled run.
_Avoid_: re-verifying triggers at scattered call sites — issuance stays with scheduler/event matcher, assertion happens once at admission.

**External CLI run**:
`executionKind: 'external'` via local CLI providers. Declares no builtin parse/DoD/iterate/progressive capabilities; `continueGoal` is supported only through the explicit external prompt contract in `agent/runners/`, which carries DoD, missing gaps, prior digest, and required evidence wording.
_Avoid_: treating CLI success as Definition of Done met.

**Builtin shell sandbox scope**:
ADR-0022 applies verified filesystem isolation to external CLI. ADR-0047
intentionally keeps builtin `bash` fail-closed under Outbound Guard `required`
when no verified shell isolation backend exists; `optional` is degraded and
`off` follows the configured unrestricted policy. Do not describe builtin shell
as sandboxed merely because the CLI path is sandboxed.

**Approval Mode（核准模式）**:
The per-run authority posture selected as `要求核准` (`always`), `代我核准` (`auto`), or `完整存取權` (`full`). Settings owns the default; the composer may override it for one task run. It is independent from Loop Pattern: Goal-based controls iteration, while Approval Mode controls whether side effects require human approval. Plan mode, explicit deny rules, capability-required approval, and unattended downgrade remain stronger constraints.
_Avoid_: calling this "control policy" in user-facing copy — that term also covers organization rules, unattended behavior, and release boundaries.

**Approval Decision（核准決策）**:
The single composed verdict — allow, deny, or ask, plus its observability events — produced for one tool invocation by evaluating every authority layer in order: feature gates, isolation blocks, plan mode, workflow gates, permission policy, bash segment rules, Approval Mode, and hook rules. Ordering is part of the meaning (a hook deny wins over everything; capability-required approval survives `完整存取權`). **Approval Mode** is one input among many to an Approval Decision, never a synonym for it.
_Avoid_: "permission check" or "guard" for the composed verdict — those describe single layers, not the decision.

**Execution evidence（執行證據）**:
The model cannot manufacture execution evidence. Model text, tool arguments,
planned state, and claimed success are not proof that a side effect occurred;
only the trusted adapter that performed the effect may issue a non-model
evidence snapshot. Missing or model-attested evidence makes the side-effect
result unsuccessful. See ADR-0048.

**Outbound Data Gate（出站資料閘門）**:
The policy-controlled boundary that decides whether information may leave SubAgents AI for an LLM or external CLI. Its effective protection mode is derived from deployment policy plus the user setting; only an effective `off` bypasses inspection. `demo` exercises the sanitization pipeline with a loopback classifier and unsealed evidence but makes no company assurance. When company protection is mandatory, users cannot weaken it; an unverifiable policy closes only those outbound paths while the rest of the app remains available.
_Avoid_: "secret filter" or `beforeRun` hook — neither expresses the complete outbound boundary or its fail-closed guarantee.

**Restricted Project View（受控專案視圖）**:
The policy-derived project content visible to any AI runner, whether builtin or external CLI. Protected Data is absent from this view rather than merely removed from the initial prompt; ordinary project content may remain available. Images are absent by default, but a policy-authorized Company Classification Endpoint with vision capability may identify regions for a sanitized derivative.
_Avoid_: "prompt filtering" or "CLI attachment allowlist" — both leave other protected project content readable after execution begins.

**Protected Data（受保護資料）**:
Project content classified as company-confidential information or personal data and therefore excluded from AI runners whenever outbound protection is active. Organization-authored rules and labels are authoritative, with local deterministic detection and an available Company Classification Endpoint covering unlabelled content; the term applies regardless of whether content originated in a file, prompt, conversation history, tool result, or attachment.
_Avoid_: "secret" alone — credentials are only one subset of the protected information boundary.

**Protected Exclusion（保護性排除）**:
A protected or uncertain segment withheld from every external AI runner while the remaining safe content continues through the run. Its exclusion record contains only the source name and a format-specific location; prompts, history, and plain text use line ranges. An image is a whole-file exclusion unless an explicitly authorized company classifier can identify protected regions and a deterministic sanitizer can produce a safe derivative.
_Avoid_: "ignore" when it could mean allowlisting or skipping future inspection — exclusion never makes the data safe to disclose later.

**Sanitized Workspace（淨化工作區）**:
A temporary, provider-specific project view used by the selected builtin or external CLI runner while outbound protection is active. It preserves ordinary project structure and locations, replaces Protected Exclusions with non-sensitive markers, and includes only policy-approved sanitized derivatives of non-text content. It never modifies or exposes the original protected content; views, caches, and exclusion state are never shared across providers.
_Avoid_: "temporary copy" alone — the defining property is the enforced AI-visible security boundary, not where files happen to be stored.

**Sanitized Sidecar（淨化旁檔）**:
A Markdown or JSON derivative that preserves the safe textual structure extracted from a PDF or Office document without reconstructing or exposing the original binary. AI runners consume the sidecar as a separate artifact and never write it back over the source document.
_Avoid_: sanitized original — the first implementation does not claim format-preserving PDF or Office reconstruction.

**Provider Security Profile（供應商安全設定檔）**:
The effective policy for one immutable provider connection ID, derived by applying its Provider Supplemental Policy on top of the Company Base Policy. It determines that connection's Protected Data rules and Sanitized Workspace without merging rules, exclusions, or state from another provider connection.
_Avoid_: treating the profile as one standalone file or as a cross-provider policy merge.

**Company Base Policy（公司統一政策）**:
The organization-wide JSON policy that establishes the minimum outbound protection applied to every provider connection. No provider-specific policy or local model result may weaken it.
_Avoid_: a UI preference or provider default — this is the common security floor.

**Provider Supplemental Policy（供應商補充政策）**:
The JSON policy associated with one immutable provider connection ID that can only add detectors, exclusions, or stronger requirements to the Company Base Policy. Supplemental policies are never merged across provider connections.
_Avoid_: provider override — it cannot remove or relax the company security floor.

**Policy Source Mode（政策來源模式）**:
The independently selected authority from which Company Base Policy and Provider Supplemental Policies are obtained: Electron main-managed `local` files or a central company `workspace` control plane. Both sources compile to the same Provider Security Profile and therefore share one enforcement pipeline.
_Avoid_: an implicit `auto` fallback — changing policy authority must be explicit and may be locked by deployment.

**Workspace Secure Envelope（工作區安全封包）**:
The authenticated application-layer encryption used when a company Workspace control plane runs over HTTP. It protects enrollment, credentials, HMAC keys, Policy Bundles, and evidence using a server public key provisioned outside that HTTP connection plus a per-device key pair.
_Avoid_: encrypted HTTP — the HTTP transport remains plaintext; the control payload itself is separately protected.

**Policy Bundle（政策組合包）**:
The atomic, versioned Workspace response for one workspace and immutable provider connection ID containing the matching Company Base Policy and Provider Supplemental Policy. A bundle becomes last-known-good only after both the server and Electron main validate its monotonic composition.
_Avoid_: independently fetched policy layers whose versions can drift.

**Security Evidence Record（安全證據紀錄）**:
One typed event in the Security Evidence Ledger describing an outbound decision, policy change or rollback, guard-mode change, Workspace sync, or evidence verification. It never contains prompts, file contents, model responses, protected plaintext, policy-sensitive values, or content digests.
_Avoid_: application log — evidence has a constrained schema and security purpose rather than arbitrary diagnostic text.

**Security Evidence Ledger（安全證據總帳）**:
The single append-only Electron main-process JSONL history used by both Policy Admin and audit tooling. All Security Evidence Records share one HMAC chain so edits, insertion, deletion, and reordering can be detected without maintaining a separate policy-change history.
_Avoid_: separate outbound and policy audit files whose histories can diverge.

**Managed Device ID（受管裝置編號）**:
A stable opaque identifier that partitions classifier requests, pending evidence, and central Workspace records by computer without deriving identity from hostname, user account, MAC address, disk serial, or other personal/hardware attributes.
_Avoid_: device fingerprint — the identifier exists for company data partitioning, not user or hardware tracking.

**Policy Admin Build（政策管理版本）**:
The `SUBAGENTS_BUILD_FLAVOR=policy-admin` packaging flavor that includes company-policy editing, Workspace bundle publishing, and Security Evidence verification surfaces on top of the same enforcement core as the standard build. Possession of this artifact grants policy-management access without runtime role authentication, but grants no bypass of the Outbound Data Gate and no access to protected plaintext.
_Avoid_: "God mode" or unrestricted build — management authority does not include disclosure or enforcement bypass.

**Company Classification Endpoint（公司分類端點）**:
An organization-hosted API inside approved company infrastructure that receives candidate content for semantic Protected Data classification before any external AI provider sees it. Outbound Guard `required` uses it as an additive enhancement when configured and reachable, but falls back to basic deterministic inspection when it is absent or unavailable. Company policy pins the complete endpoint URL, commonly ending in `/v1`; the client posts its structured classification contract directly to that URL, appends no route suffix, and refuses redirects. Policy may explicitly approve plaintext HTTP, which is recorded as unencrypted. Authentication is an independent option: when absent no credentials are required, but once configured it must succeed without fallback.
_Avoid_: "local URL", "local model", or "required classifier" — a non-loopback address is a company disclosure boundary, and classifier availability never controls whether baseline protection runs.

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
