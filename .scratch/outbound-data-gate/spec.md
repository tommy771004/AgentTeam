# 公司出站資料閘門與受控專案視圖

Status: resolved

## Problem Statement

公司使用 SubAgents AI 連接雲端 LLM 或外部 CLI 時，現有執行流程會讓模型與 CLI 接觸 prompt、對話歷史、附件、工具結果及專案檔案。即使供應商的商務工作區承諾不使用公司資料訓練模型、提供保存與管理控制，這些供應商端保障仍無法在資料離開電腦前，依公司的機密與個資政策決定哪些內容根本不應送出。

單純過濾初始 prompt 或建立 ignore 清單也不足以形成安全邊界：外部 CLI 可在執行後自行讀取原始專案、絕對路徑、使用者目錄或符號連結；內建代理後續輪次還會產生新的系統提示、歷史、附件與工具結果。若只在任務開始前檢查一次，受保護資料仍可能從其他出口離開。

公司需要一個可由部署設定開啟或關閉、可按供應商隔離、不中斷一般服務、並能被事後驗證的 Outbound Data Gate。保護啟用時，AI 只能讀取 Restricted Project View；受保護或無法安全辨識的區段必須略過，其他安全內容仍可繼續執行。必要保護若無法建立可信邊界，只封鎖相關 LLM 或 CLI 出站路徑，不應讓整個桌面應用程式停止運作。

## Solution

在所有 LLM 與外部 CLI 的最後出站點前建立統一的 Outbound Data Gate。它依 `SUBAGENTS_OUTBOUND_GUARD=off|demo|optional|required`、明確選定的 Policy Source Mode，以及該 immutable provider connection ID 的 Provider Security Profile，為每次出站決定允許、淨化、降級或阻擋。

保護啟用時，Electron main 在原始專案之外建立 provider-specific Sanitized Workspace。文字中的 Protected Exclusion 以不含敏感資訊的固定標記取代並保留定位；圖片預設不可讀；PDF 與 Office 文件只提供經本機解析與淨化的 Markdown/JSON Sanitized Sidecar。內建代理的 prompt、歷史、附件、工具結果與每一輪呼叫，以及外部 CLI 可見的檔案系統，都必須使用同一個 Provider Security Profile 與受控視圖。

公司政策採兩層 JSON：Company Base Policy 是不可削弱的共同底線，Provider Supplemental Policy 只能為單一 provider connection 增加或收緊規則。`required` 且設定公司自架 Company Classification Endpoint 時，端點可額外辨識語意型機密與個資，但只能增加排除，失效時回到不可移除的 deterministic baseline。Policy Source Mode 可在 Electron main 管理的 `local` 與中央 `workspace` 間明確切換；Workspace 以原子 Policy Bundle、last-known-good 快取與公司指定的離線策略維持版本一致。

每個重要出站、政策、模式、Workspace 同步與裝置生命週期決策都寫入同一份 Electron main Security Evidence Ledger。它只記錄 provider、政策版本、動作、檔案名稱與格式定位範圍等 metadata，不記錄 prompt、檔案內容、模型輸出、受保護明文或內容摘要。正式模式可用 safeStorage 保管的 per-device HMAC key 建立可驗證鏈；中央 Workspace 以 Managed Device ID 分區並在背景增量上傳。`SUBAGENTS_BUILD_FLAVOR=policy-admin` 只增加政策草稿、發布與證據驗證管理面，不得繞過 Outbound Data Gate 或看到受保護內容。

## User Stories

1. As a 公司員工, I want the agent to see only company-approved project content, so that confidential and personal data do not leave my computer through an AI provider.
2. As a 公司員工, I want safe parts of a task to continue after protected parts are excluded, so that security protection does not unnecessarily interrupt my work.
3. As a 公司員工, I want protected text replaced by a clear non-sensitive marker, so that the agent understands that content is intentionally unavailable rather than missing by accident.
4. As a 公司員工, I want line mapping preserved after sanitization, so that safe edits and diagnostics still refer to useful project locations.
5. As a 公司員工, I want images ignored by default, so that screenshots, scans, diagrams and embedded personal data are not silently disclosed.
6. As a 公司員工, I want unsupported or uncertain non-text content to remain unavailable, so that format ambiguity is not treated as permission to disclose it.
7. As a 公司員工, I want PDF and Office content represented through safe sidecars, so that an agent can use approved text without receiving the original binary.
8. As a 公司員工, I want the original project left unchanged during sanitization, so that security processing cannot corrupt source files.
9. As a 公司員工, I want safe agent changes written back while protected-overlap changes are withheld, so that useful work survives without overwriting confidential regions.
10. As a 公司員工, I want withheld writeback hunks reported by source and location only, so that I can understand the outcome without reproducing protected content in logs.
11. As a CLI user, I want the external CLI restricted to the Sanitized Workspace, so that it cannot bypass prompt filtering by reading the original project.
12. As a CLI user, I want required mode to verify filesystem isolation before starting a CLI, so that absolute paths, home directories and symlinks cannot escape the security boundary.
13. As a CLI user, I want direct sanitized LLM work to remain available when CLI sandboxing is unavailable, so that one missing platform capability does not disable all AI assistance.
14. As a user in optional mode, I want to enable or disable outbound protection in Settings, so that I can choose the posture when company deployment does not mandate it.
15. As a user in required mode, I want the protection control shown as enforced and read-only, so that I cannot accidentally weaken a company requirement.
16. As a demo user, I want the full sanitization flow to run against localhost without HMAC setup, so that I can demonstrate the feature with minimal infrastructure.
17. As a demo user, I want sanitized prompts and projects to remain usable by configured LLMs and CLIs, so that the demo proves the actual workflow rather than a static preview.
18. As a demo user, I want a visible non-enterprise warning and unsealed temporary evidence, so that demo behavior is never mistaken for a company assurance.
19. As a user with guard mode off, I want the existing execution path preserved, so that environments not using company protection do not pay the sanitization cost.
20. As a security administrator, I want `SUBAGENTS_OUTBOUND_GUARD` to define the deploy-time posture, so that protection can be governed outside renderer preferences.
21. As a security administrator, I want only effective `off` to bypass inspection, so that every other active posture follows a known security path.
22. As a security administrator, I want required mode to pin one Policy Bundle at Task run admission, so that every LLM round, tool result and writeback uses a consistent policy version.
23. As a user in optional mode, I want active protection to resolve the current policy at every outbound call, so that policy changes take effect without restarting unrelated work.
24. As a security administrator, I want Company Base Policy to apply to every provider connection, so that the organization has one minimum protection floor.
25. As a security administrator, I want one Provider Supplemental Policy per immutable provider connection ID, so that two accounts from the same vendor cannot share rules or sanitized state accidentally.
26. As a security administrator, I want provider supplements to only add or tighten protection, so that a provider-specific file cannot weaken the company floor.
27. As a security administrator, I want missing baseline and provider files created automatically, so that first use is protected without manual bootstrap work.
28. As a security administrator, I want malformed active policy files preserved and the affected provider blocked, so that automatic repair cannot erase forensic evidence or silently change policy.
29. As a security administrator, I want policy files stored outside projects and renderer localStorage, so that agents and project code cannot edit their own security boundary.
30. As a security administrator, I want to point local policy storage at a company-managed directory, so that operating-system deployment tools can own the policy location.
31. As a security administrator, I want explicit `local` or `workspace` Policy Source Mode, so that authority never changes through an implicit fallback.
32. As a security administrator, I want local and Workspace policies compiled into the same Provider Security Profile, so that source selection does not create two enforcement implementations.
33. As a Workspace administrator, I want company and provider policy returned as one atomic bundle, so that layers cannot be applied at mismatched versions.
34. As a Workspace administrator, I want bundle version, ETag and monotonic validation, so that rollback, replay and partial sync are detectable.
35. As an offline employee, I want a valid last-known-good Workspace bundle used according to company policy, so that temporary connectivity loss does not unnecessarily interrupt work.
36. As a security administrator, I want the cache age and expired-cache action set in company policy, so that offline continuity remains an explicit risk decision.
37. As a security administrator, I want required Workspace mode to block outbound work by default after the policy cache expires, so that stale policy is not silently trusted.
38. As a security administrator, I want Workspace authentication required with bearer secret references or mTLS, so that policy authority is not accepted anonymously.
39. As a Workspace operator, I want HTTPS or an authenticated Workspace Secure Envelope, so that policy, enrollment and evidence control data are protected in transit.
40. As a Workspace operator using HTTP, I want server public keys provisioned outside the endpoint and redirects denied, so that plaintext HTTP cannot redefine its own trust anchor.
41. As a Workspace operator, I want overlapping public keys supported during rotation, so that key migration does not require a service outage.
42. As a Workspace operator, I want failed envelope authentication to fall back only to valid cached policy, so that invalid ciphertext is never interpreted as plaintext control data.
43. As a security administrator, I want a deterministic baseline for credentials and authentication material, so that common secrets remain protected without a model.
44. As a security administrator, I want baseline detection for Taiwan identity, contact and financial data, so that common personal data receives immediate protection.
45. As a security administrator, I want sensitive paths and secret-bearing field names covered by the baseline, so that `.env`, keys and credential files are not exposed through ordinary file access.
46. As a security administrator, I want the baseline to remain irreducible, so that a company policy, provider supplement or classifier cannot disable its minimum rules.
47. As a security administrator, I want organization rules to cover names, addresses and internal project terms, so that company context can extend beyond deterministic patterns.
48. As a security administrator, I want a company-hosted `/v1` classification endpoint usable only when required protection is configured, so that semantic classification stays within the approved company boundary.
49. As a security administrator, I want classifier results to only add exclusions, so that a model cannot overrule deterministic or company-authored protection.
50. As an employee, I want required mode to fall back to baseline when an optional classifier is absent or temporarily unavailable, so that useful service continues safely.
51. As an operator, I want classifier retries limited to three total attempts and only transient failures retried, so that failures are bounded and observable.
52. As an operator, I want authentication, client and invalid-response failures not retried, so that configuration errors are not hidden behind repeated calls.
53. As a security administrator, I want the exact classifier URL called without an appended route or redirect, so that the disclosure destination is predictable and auditable.
54. As a security administrator, I want HTTP classifier use explicitly approved and marked as plaintext, so that transport risk is never implied to be encrypted.
55. As a security administrator, I want classifier authentication configured independently as none, bearer, custom header or mTLS, so that deployment does not assume one API style.
56. As a security administrator, I want classifier credentials referenced from secure storage rather than policy JSON, so that policy files do not become secret stores.
57. As a security administrator, I want the classifier receive one source chunk at a time with structured locators, so that findings can be mapped without sending an entire project at once.
58. As a security administrator, I want image vision disabled unless Company Base Policy explicitly enables it, so that images remain a deny-by-default data class.
59. As a security administrator, I want any allowed image finding returned as bounding boxes and masked deterministically, so that the external AI receives only a sanitized derivative.
60. As a reviewer, I want every active outbound decision represented in a constrained Security Evidence Record, so that I can verify enforcement without seeing user content.
61. As a reviewer, I want records to contain only timestamps, run/provider/policy identity, classifier status, decision and source locators, so that auditability does not create a second data-leak channel.
62. As a reviewer, I want no prompt, file body, model output, protected plaintext or content digest in evidence, so that the ledger cannot reconstruct sensitive work.
63. As a reviewer, I want a single weekly JSONL ledger using Asia/Taipei week boundaries, so that outbound, policy and device events share one chronological history.
64. As a reviewer, I want event types to distinguish outbound decisions, policy changes, guard changes, sync, device lifecycle and verification, so that one ledger remains queryable without separate histories.
65. As a reviewer, I want an HMAC chain to detect edits, insertion, deletion, reorder and truncation, so that local evidence can be verified cryptographically.
66. As a reviewer, I want each new weekly file linked to the prior week's terminal MAC, so that week rotation does not reset chain continuity.
67. As a security administrator, I want safeStorage failure governed by `block` or `unsealed`, so that required environments do not silently downgrade evidence integrity.
68. As an operator, I want the mode transition recorded when protection turns off, so that periods without outbound evidence are explainable.
69. As a Workspace operator, I want evidence written durably locally before background upload, so that network failure cannot lose an already accepted decision.
70. As a Workspace operator, I want small idempotent batches and highest-sequence acknowledgement, so that retries do not duplicate or reorder evidence.
71. As an employee, I want evidence upload failure queued without blocking safe task execution, so that central audit downtime does not stop normal work.
72. As a records administrator, I want weekly retention configured in weeks with zero meaning forever, so that retention is explicit and predictable.
73. As a records administrator, I want unacknowledged evidence excluded from ordinary deletion, so that background upload cannot race retention.
74. As a reviewer, I want retention checkpoints distinguish authorized expiry from malicious truncation, so that deletion remains verifiable.
75. As a Workspace administrator, I want evidence partitioned by workspace, Managed Device ID and ISO week, so that multiple computers remain independently traceable.
76. As an employee, I want device identity to be opaque and unrelated to hostname, user, MAC or disk identifiers, so that audit partitioning does not become device fingerprinting.
77. As a Workspace administrator, I want first authenticated enrollment to issue a device ID and per-device HMAC key, so that each computer has an independent verifiable chain.
78. As a Workspace administrator, I want device replacement to create a new identity and key while retiring the old device, so that changing computers does not transfer trust material.
79. As a reviewer, I want replacement links and unrecoverable pending-evidence gaps recorded explicitly, so that lost hardware does not create an invisible audit hole.
80. As a policy administrator, I want to edit a draft rather than the active policy, so that incomplete changes cannot affect running users.
81. As a policy administrator, I want schema, identity, monotonic and synthetic-fixture validation before activation, so that an invalid policy cannot become authoritative.
82. As a policy administrator, I want activation and Workspace publishing to be explicit actions, so that saving a draft is not mistaken for deploying it.
83. As a policy administrator, I want rollback to create a new increasing version with rollback metadata, so that policy history never moves backward or disappears.
84. As a policy administrator, I want to see what changed by rule ID and field name without protected values, so that policy reviews are useful and safe.
85. As a build operator, I want `SUBAGENTS_BUILD_FLAVOR=standard|policy-admin` resolved at compile time, so that management capability is determined by the distributed artifact.
86. As a build operator, I want unset flavor to produce standard and unknown values to fail the build, so that packaging mistakes are deterministic.
87. As a user, I want the immutable build flavor visible in About and Settings, so that I know whether policy-management surfaces are present.
88. As a security administrator, I want Policy Admin to share the same enforcement core and never reveal protected plaintext, so that management authority is not a security bypass.
89. As a release operator, I want both flavors to keep the same product identity and update channel, so that company deployment does not create a divergent product line.
90. As a developer, I want every product ingress and every later LLM round to cross the same egress contract, so that composer, automation, delegate and tool-loop paths cannot drift.
91. As a developer, I want renderer and project code unable to access policy secrets, HMAC keys or original protected content through the security API, so that the trust boundary remains in Electron main.
92. As a reviewer, I want one high-level scenario harness to prove what fake LLM and CLI destinations receive, so that tests verify external behavior rather than sanitizer internals.
93. As a reviewer, I want platform smoke contracts for safeStorage, IPC, build flavor and sandbox capability, so that environment-specific wiring is verified without duplicating behavior tests.
94. As a support engineer, I want blocked and degraded reasons exposed without sensitive content, so that I can diagnose configuration and policy problems safely.

## Implementation Decisions

- The Outbound Data Gate is a final egress boundary, not a `beforeRun` hook. Every builtin LLM call, including system instructions, user prompt, history, attachment descriptions, tool results and subsequent function-calling rounds, passes through it immediately before transport. External CLI dispatch passes through the same policy decision before process creation.
- The effective guard mode is derived from `SUBAGENTS_OUTBOUND_GUARD=off|demo|optional|required` plus the permitted UI setting. Unset behavior follows the product default chosen for backward-compatible standard installations; unknown values fail configuration validation rather than silently selecting a weaker mode.
- `off` bypasses classification and sanitization. Only the transition into or out of off is recorded because outbound payload decisions are not inspected in this mode.
- `optional` exposes the protection control in Settings. When enabled, the current effective policy is resolved for every outbound call. When disabled, the effective mode is off.
- `required` makes the UI control read-only and active. The atomic policy version is pinned at Task run admission and reused for every builtin round, external CLI view, tool-result reinjection and safe writeback belonging to that run.
- `demo` exercises the same sanitization path, may use a loopback classifier, and permits configured external LLM and CLI transports after sanitization. It does not require HMAC, produces temporary unsealed evidence, and is visibly labelled as unsuitable for company assurance. Loopback classifier failure falls back to the deterministic baseline.
- Guard mode and Policy Source Mode are independent. `SUBAGENTS_POLICY_SOURCE=local|workspace` has no implicit auto value. A deployment may lock the selected source so renderer settings cannot replace its authority.
- Settings additions remain part of the existing flat LLM settings contract. Structured array/object fields receive explicit persisted-merge handling, and live settings continue to reconfigure the engine without creating another settings store.
- Enforcement is owned by Electron main because it controls filesystem access, network transport, CLI process creation, safeStorage and evidence. Renderer APIs expose decisions and non-sensitive status only; they do not expose active policy secrets, HMAC keys, original protected content, or arbitrary raw-policy filesystem access.
- The Company Base Policy and Provider Supplemental Policy use versioned JSON schemas. The base is an organization-wide floor. Each supplement is keyed by an immutable provider connection ID and may only add detectors, exclusions, transport restrictions, evidence requirements or other stronger constraints.
- A Provider Security Profile is compiled by monotonic merge: company rules always survive, supplemental rules never remove or relax them, and two provider connections never share supplemental policy, Sanitized Workspace, cache or exclusion state.
- Provider identity represents a configured connection, not merely a vendor brand. Existing provider settings receive stable connection IDs through a backward-compatible migration before independent policy state is used.
- Local policy lives outside the project tree and renderer localStorage under Electron main ownership. `SUBAGENTS_OUTBOUND_POLICY_DIR` may select a company-managed location.
- When no Company Base Policy exists, Electron main creates a built-in baseline policy. When a known provider connection lacks a supplement, it creates an empty additive supplement. Creation is atomic and recorded without sensitive values.
- An existing malformed policy is never overwritten automatically. The affected provider's protected outbound calls are blocked until an explicit repair, rebuild or valid activation establishes a new last-known-good policy.
- Policy signatures are deferred from v1. Documentation must state that unsigned local JSON cannot resist an operating-system user or administrator who can modify the policy directory. Signed canonical JSON and stronger local tamper resistance remain follow-up work.
- Workspace returns one atomic Policy Bundle per workspace and provider connection containing matching company and supplemental policy versions. The server validates it before publication; Electron main independently validates schema, provider identity, monotonic composition, bundle version and ETag before marking it last-known-good.
- Workspace authentication is mandatory when Workspace is the selected source. Supported modes are bearer secret reference and mTLS; there is no anonymous or silent local-source fallback.
- A valid last-known-good Workspace bundle may be used offline according to Company Base Policy fields `offlineCache.maxAgeHours` and `offlineCache.onExpired=block|basic|use-stale`. Required Workspace posture defaults to `block` when the cache expires. The status is visible and recorded.
- HTTPS Workspace transport uses its normal authenticated channel. If a Workspace endpoint uses HTTP, all enrollment, authentication, evidence-key, Policy Bundle and evidence-upload payloads require a Workspace Secure Envelope; HTTP never carries those values as plaintext.
- Workspace HTTP trust anchors are provisioned to Electron main through `SUBAGENTS_WORKSPACE_PUBLIC_KEYS` as overlapping `keyId:BASE64` entries. The endpoint is pinned, redirects are rejected, renderer/policy/server responses cannot edit trust anchors, and HTTP Workspace mode is unavailable when no provisioned key matches.
- The Workspace Secure Envelope uses standard authenticated encryption, per-device key material, nonces/sequence data and replay protection. Authentication or decryption failure may use only an eligible cached bundle; it never falls back to interpreting plaintext.
- The irreducible deterministic baseline covers credentials and authentication material, private keys, passwords, common connection strings and cloud credentials; Taiwan identity/contact patterns; payment-card/Luhn and common bank fields; sensitive paths such as environment, credential, secret, key and certificate files; and secret-bearing field names.
- Company-authored rules and labels extend classification for context-dependent information such as names, addresses, internal project names and company-specific identifiers. They cannot disable baseline detectors.
- The Company Classification Endpoint is an optional additive enhancement used when guard mode is `required` and the endpoint is configured; demo may independently use a loopback classifier. Optional and other active modes retain deterministic/company-rule inspection without requiring this service.
- The classifier endpoint setting is the complete pinned request URL, commonly ending in `/v1`. The client POSTs the structured classification request directly to that exact URL, appends no path segment, refuses redirects and records whether transport was HTTPS or company-approved plaintext HTTP.
- Classifier authentication is independent of transport and supports none/omitted, bearer, custom header and mTLS. Credentials are secret references outside policy JSON. Once authentication is configured, auth failure is a configuration failure and does not retry anonymously.
- A classifier call sends one source and one bounded chunk with workspace ID when applicable, Managed Device ID, provider identity, source kind and format-specific locator. Plain text, prompt, history and tool results use virtual source names and line ranges; PDF uses page/block; spreadsheets use sheet/cell; database-like adapters use table/column/row locators.
- Classifier results may only add Protected Exclusions. They never release a baseline or company-policy exclusion. No classifier request is sent to an external AI provider; the configured organization endpoint is itself treated as a separately approved disclosure boundary.
- There are at most three classifier attempts total. Only timeout, network, HTTP 429 and HTTP 5xx failures receive short bounded backoff. HTTP 4xx, authentication failure and invalid response do not retry. Exhaustion records degraded classifier status and continues with deterministic baseline unless another mandatory policy condition independently requires blocking.
- Connection testing uses synthetic content and never samples the user's project, prompt or history.
- Text sanitization replaces protected spans with stable non-sensitive markers while preserving file and line mapping. The original text and protected substring are absent from the Sanitized Workspace, temporary logs and evidence.
- Images are whole-file Protected Exclusions by default and are not decoded or read by AI runners. Company Base Policy may explicitly authorize a vision-capable Company Classification Endpoint; it returns bounding boxes, deterministic local code masks those regions, and only the verified sanitized derivative enters the provider-specific workspace.
- PDF, DOCX, XLSX and PPTX use local structure-aware adapters. The first version extracts approved structure, applies deterministic and optional company classification, and produces Markdown/JSON Sanitized Sidecars. AI never receives the original binary and never writes a sidecar back over it.
- ZIP, SQLite and unknown or untrusted formats remain unavailable until a dedicated adapter can provide reliable locators and sanitization. File-extension allowlists alone are not considered content recognition.
- Each protected run uses a provider-specific Sanitized Workspace outside the original project. It contains only approved project structure, sanitized text, allowed sidecars and sanitized image derivatives. External symlink targets, caches and provider state are not copied or shared.
- Builtin file tools and all other AI-readable project operations resolve against the Restricted Project View when protection is active. Adding a new file-reading tool must declare and test how it receives that view; direct access to the original project is not an allowed fallback.
- Required external CLI execution needs a verified filesystem sandbox that exposes the Sanitized Workspace plus required runtime dependencies while denying the original project, home directory, unrelated paths and external symlink targets. Sanitized current working directory alone is not a verified boundary.
- If required-mode sandbox capability is unavailable, external CLI is disabled with a non-sensitive reason while sanitized direct LLM execution remains available. Optional/demo may run a CLI from the sanitized current directory only when the product visibly marks and records filesystem isolation as unverified.
- Agent edits occur in the Sanitized Workspace. Writeback compares sanitized changes to the source mapping and applies safe hunks to the original project. A hunk overlapping a Protected Exclusion is withheld and recorded by source and locator; unrelated hunks continue. Original non-text documents remain immutable in v1.
- Sanitization is continuity-oriented: protected and uncertain segments are excluded, safe segments continue, and unsupported content becomes unavailable. Failure to create or execute the irreducible baseline under mandatory protection blocks only the affected AI/CLI outbound operation; the desktop app, settings, diagnostics and local non-AI features remain available.
- Security Evidence Records share a constrained versioned JSON schema. Outbound records contain UTC timestamp, event ID, sequence, run ID, provider ID, effective guard mode, Policy Source Mode, policy/bundle version and change ID, classifier used/attempt count/status, filesystem isolation status, action, and Protected Exclusion source/locator.
- Evidence never contains prompt text, conversation text, file bodies, protected plaintext, model responses, policy-sensitive values or content digests. Filenames and format-specific location ranges are the maximum content references.
- All evidence event types use one append-only Electron main ledger: outbound-decision, policy-change, policy-rollback, guard-mode-change, workspace-sync, device-retired, device-replaced, evidence-verification and retention-checkpoint.
- The physical ledger is weekly JSONL named by ISO week. Week calculation uses Asia/Taipei with Monday as the first day; each event timestamp remains UTC. A new week links to the previous week's terminal MAC.
- Sealed records use a sequence number, previous MAC and record MAC over canonical metadata. The per-device HMAC key is protected with safeStorage and is never written in plaintext. Verification detects mutation, insertion, deletion, reorder and unexpected truncation.
- Company policy defines `evidence.onKeyUnavailable=block|unsealed`. Required defaults to block when sealed evidence is mandatory; optional may emit clearly marked unsealed records. Demo uses temporary unsealed evidence.
- Evidence destination is `local|workspace|both`. Required with Workspace defaults to both; local policy defaults to local. A durable local append occurs before background Workspace upload.
- Background upload uses small ordered batches, event ID plus sequence idempotency, and highest contiguous acknowledgement. Failures remain queued and do not block otherwise safe service. Central acknowledgement is required before ordinary retention removes uploaded local records.
- Company policy sets weekly `retentionWeeks`, where zero means retain forever. Pending upload records are not deleted by normal retention. A retention checkpoint proves policy-authorized deletion rather than chain tampering.
- Workspace stores evidence by workspace ID, Managed Device ID and ISO week. Device IDs are opaque random identifiers and do not derive from hostname, user account, MAC address, disk serial or other hardware/person identifiers.
- First authenticated Workspace enrollment issues an immutable Managed Device ID and a per-device evidence HMAC key. Local standard/demo installations may create an opaque local UUID; demo does not require HMAC. A human-readable device label is separate from identity.
- Reinstall or employee computer replacement creates a new device ID and key unless an explicit re-enrollment protocol says otherwise. The old device is retired/revoked, central history keeps old verification keys, and a device-replaced event links old and new identities without moving the old key or policy cache.
- Pending evidence that cannot be recovered from a lost device is represented as an explicit unrecoverable gap; it is not silently treated as uploaded or deleted.
- Policy Admin edits immutable drafts rather than active policy. Activation runs schema, provider identity, monotonic-merge and synthetic fixture validation, then requires an explicit activate or Workspace publish action. Active versions are never edited in place.
- Rollback creates a new monotonically increasing policy version with rollback target and reason metadata. The Security Evidence Ledger records changed rule IDs and field names plus reason and relationship, while complete policy versions remain in the policy store.
- `SUBAGENTS_BUILD_FLAVOR=standard|policy-admin` is resolved at build time. Unset produces standard; unknown values fail the build. The compiled immutable flavor appears in About and Settings.
- Policy Admin adds draft editing, validation, activation, Workspace publishing and evidence verification. Possession of the artifact is the management authority in v1; no runtime administrator login or role is added. This distribution risk must be documented.
- Standard and Policy Admin retain the same application ID, product identity, artifact family and update channel. They share one guard/sanitization core, and Policy Admin cannot bypass protection or reveal Protected Data.
- The feature preserves the existing canonical Task run ingress, builtin/external capability semantics, approval model and default single-run/concurrency behavior. The guard is an orthogonal data boundary, not another runner or coordinator.

## Testing Decisions

- A good test observes what an outbound destination, user, original workspace and evidence verifier can see. It must assert disclosed payloads, blocked/degraded outcomes, safe writeback and verifiable metadata rather than private detector function order, temporary directory names or internal object layout.
- The single primary behavioral seam is a high-level scenario harness from canonical `runTask` admission through the Outbound Data Gate to fake LLM and fake CLI destinations. It uses a temporary project plus fake classifier, Workspace, policy source, evidence sink and filesystem sandbox.
- Scenario fixtures cover prompts, history, tool results, attachments and project files containing baseline credentials, Taiwan personal identifiers, company-only terms, ordinary text, images and supported document sidecars. The fake destinations must be able to prove that protected originals never arrived.
- The scenario matrix covers `off`, active/inactive `optional`, `required` and `demo`; required run policy pinning; optional per-call policy refresh; provider-connection isolation; missing-file bootstrap; malformed-policy blocking; classifier success, additive findings, transient exhaustion and non-retryable failure; and last-known-good Workspace cache behavior.
- CLI scenarios assert that required mode dispatches only after verified filesystem isolation, cannot read original/absolute/home/symlink paths, and remains disabled when the sandbox is unavailable. Optional/demo unverified isolation must be visible in outcome and evidence.
- Writeback scenarios modify safe and protected-overlap regions in one run, assert that safe hunks reach the original project, protected hunks do not, and evidence contains only source/locator metadata.
- Non-text scenarios assert images are unopened by default, policy-authorized vision produces only a masked derivative, PDF/Office originals never reach the destination, and unsupported formats are unavailable while the rest of the task continues.
- Evidence scenarios assert weekly Asia/Taipei rotation, canonical chain verification, cross-week linking, edit/insert/delete/reorder/truncation detection, safeStorage unavailability policy, local-first background upload, idempotent acknowledgement, retention checkpoints and device replacement gaps. Negative assertions scan records for fixture secrets and model output.
- Workspace Secure Envelope scenarios use synthetic keys and payloads to assert trust-anchor pinning, authenticated encryption, replay rejection, overlapping key rotation, redirect denial, no plaintext HTTP fallback, and eligible cache fallback after authentication failure.
- Policy Admin scenarios build both flavors and assert standard excludes management surfaces, policy-admin includes them, unknown flavor fails, draft validation gates activation, rollback increases version, and neither flavor changes outbound enforcement.
- Existing scenario smoke tests are prior art for fake bridges and canonical Task run behavior. Existing security smoke and built Electron contract tests remain a narrow secondary platform seam for Electron main ownership, IPC exposure, safeStorage/HMAC wiring, compile flavor and sandbox adapter availability; they do not duplicate product behavior assertions.
- Pure detector, monotonic policy merge, locator and canonical-MAC vectors may have focused production-module smoke coverage when deterministic edge cases cannot be diagnosed through the scenario harness. These tests still assert stable public contracts and do not become alternate egress paths.
- Verification for implementation includes the repository build/typecheck, the complete smoke suite including security and scenario contracts, lint, and diff whitespace checks. Test fixtures use only synthetic secrets and personal data.

## Out of Scope

- A claim that OpenAI, another LLM vendor, or a ChatGPT business workspace alone enforces this client-side Restricted Project View. Provider retention, training and workspace controls remain complementary vendor assurances.
- Signed local policy files, canonical-JSON signatures, remote attestation, operating-system administrator resistance, hardware-backed keys or full endpoint-device management in v1.
- Runtime administrator authentication, RBAC or approval workflows inside the Policy Admin Build. Artifact possession is the initial management authority.
- Separate application IDs, product names, update channels or divergent Free/Pro binaries for standard and policy-admin flavors.
- Format-preserving editing or reconstruction of PDF, DOCX, XLSX and PPTX originals. The first version supplies read-only sanitized sidecars.
- ZIP, SQLite, arbitrary archives, databases or unknown binary formats before dedicated safe adapters exist.
- OCR or vision processing by external AI providers. Image inspection is limited to a Company Base Policy-authorized Company Classification Endpoint and deterministic local masking.
- Letting a company classifier, provider supplement, user setting or local model remove an irreducible baseline exclusion.
- Automatic switching between `local` and `workspace` policy authority when one source is unavailable.
- HMAC for localhost demo mode, permanent upload of demo evidence, or describing demo results as enterprise-verifiable.
- Capturing protected content, prompts, responses, screenshots or content hashes in evidence for forensic convenience.
- Seamless transfer of an old device's HMAC key, pending evidence or policy cache to a replacement computer.
- Relaxing tool Approval Decisions, CLI DoD semantics, task concurrency policy, automation consent or any existing execution safety layer. The Outbound Data Gate composes with those controls.

## Further Notes

- The spec uses the domain vocabulary in `CONTEXT.md` and treats ADR-0004 through ADR-0022 as accepted decisions. Implementations should preserve those decisions rather than reopening transport, policy monotonicity, evidence minimization, sidecar or sandbox choices inside individual tickets.
- ChatGPT Business and Enterprise workspace protections can reduce vendor-side training, retention and administrative risk, but they operate after data reaches the provider. The Outbound Data Gate is the complementary client-side control that decides what may leave SubAgents AI at all.
- The highest test seam was confirmed with the user: canonical Task run to real egress gate to fake LLM/CLI. Electron platform checks remain intentionally narrow.
- Availability and confidentiality are balanced by excluding protected segments and continuing safe work. Fail-closed means closing an affected outbound path when its mandatory boundary cannot be verified, not terminating the desktop application or deleting user work.
- Filenames and locators can themselves reveal limited metadata. Company deployments should choose project naming conventions and evidence retention with that residual risk in mind; the first version does not hash locators because verifiers need actionable source mapping and content digests are explicitly forbidden.

## Implementation progress (2026-07-21)

Tickets **01–15** core pure modules + smokes complete under `app/src/agent/outbound/`.
Platform follow-ups: Electron main safeStorage key wiring, OS sandbox adapter, real PDF/Office codecs, Settings policy-admin UI surfaces.

## Platform wiring (2026-07-21)

- `electron/outboundBridge.ts` + IPC `outbound:*` (status / ensurePolicy / prepareRunView / disposeRunView / appendEvidence)
- `taskRunCoordinator` pins Restricted Project View when protection active; disposes on finalize
- Settings + Dashboard surface guard/flavor/policy metadata (non-sensitive)
- `smoke-outbound-platform.mts` drift guard

## Platform wiring continued (2026-07-21)

- `electron/cliFilesystemSandbox.ts`: seatbelt/bwrap profile + real canary probe
- IPC `outbound:sandboxProbe` / `outbound:viewMeta`
- `localCliRun` awaits probe when Restricted View bound
- Settings: classification endpoint + synthetic connection test; policy-admin surface when flavor matches
- `smoke-cli-filesystem-sandbox.mts`

## CLI process wrap (2026-07-21)

- `localCliRun` passes `sandboxWrap: { engine, viewRoot }` when probe is `verified`
- `localCliRunner` wraps argv via `wrapCommandInSandbox` (seatbelt-exec / bwrap) before `runArgv`
- Temporary seatbelt profile cleaned in `finally`

## Policy Admin Settings (2026-07-21)

- `electron/policyAdminBridge.ts`: drafts/ under policy dir; activate writes company-base.json / providers/*; rollback bumps version
- IPC `outbound:policyListActive|ListDrafts|ReadDraft|SaveDraft|ActivateDraft|Rollback|SeedDraft`
- Settings → Policy Admin (nav only when `SUBAGENTS_BUILD_FLAVOR=policy-admin`)
- smoke-policy-admin-bridge

## Office/PDF extract + supplement drafts (2026-07-21)

- `officeZipExtract.ts`: minimal ZIP reader; DOCX/XLSX/PPTX structure; PDF Tj string harvest
- `buildSanitizedSidecar` uses real extract then sanitize; binary never returned
- Restricted Project View emits `*.sidecar.md` for parseable documents
- Policy Admin UI: draft kind company-base | provider-supplement + connection id
- smokes: smoke-office-extract, policy-admin supplement activate

## View E2E (2026-07-21)

- `smoke-outbound-view-e2e`: project with text/docx/pdf secrets → Restricted View has no binaries/secrets; sidecars sanitized; fake LLM gate payload clean
- XLSX `parseWorkbookSheetNames` from workbook.xml
