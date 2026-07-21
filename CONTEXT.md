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

**Approval Decision（核准決策）**:
The single composed verdict — allow, deny, or ask, plus its observability events — produced for one tool invocation by evaluating every authority layer in order: feature gates, isolation blocks, plan mode, workflow gates, permission policy, bash segment rules, Approval Mode, and hook rules. Ordering is part of the meaning (a hook deny wins over everything; capability-required approval survives `完整存取權`). **Approval Mode** is one input among many to an Approval Decision, never a synonym for it.
_Avoid_: "permission check" or "guard" for the composed verdict — those describe single layers, not the decision.

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
