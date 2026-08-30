# Codex-aligned 個人化自訂指令與專案上下文

Status: 待補資訊

## Problem Statement

使用者希望像 Codex Desktop 一樣，在「個人化」中設定一份會套用到所有新任務的自訂指令，並確定 Agent 會在處理當前請求前先取得這些內容。現有 AgentStudio 已有「個人化」中的人格、關於使用者與回覆偏好，也在 Learning 中另有「人格與上下文」及一份名為 AGENTS 的內部 stable prompt；同時，執行路徑還會從專案檔案系統載入真正的 AGENTS／CLAUDE 指引。三者入口、authority、持久化與名稱重疊，使用者無法判斷自己編輯的是全域預設、Agent 人格、實體專案檔案，或只是 renderer 內的一份相容資料。

目前的專案指引以實體檔案為 canonical source，個人化偏好則留在 flat settings／legacy learning persistence。這使使用者無法在一個一致的 UI 中查看實際套用順序、來源、include 結果、revision、hash、裁切或錯誤，也無法證明某次 Task run 究竟使用了哪一版指令。若把所有內容直接搬進既有 durable-memory SQLite，則會擴張 Memory Extension 的既定 authority；若只存在 SQLite，又會使 Codex CLI、Claude CLI、IDE、Git branch 與 worktree 看不到專案指令。

使用者需要一個 Codex-aligned 的「個人化」入口，但底層必須清楚區分全域 DB-owned 自訂指令與 filesystem-owned 專案指令，在 Task run admission 凍結可稽核的有效 instruction snapshot，並維持系統安全政策、專案特定規則、使用者預設與持久記憶之間的固定 authority 順序。

## Solution

將「個人化」定為唯一的一般使用者入口，整合人格、全域自訂指令、進階人格指令與目前專案指令來源。全域人格與自訂指令由新的 Host-owned Instruction Repository 持久化在獨立 SQLite authority；真正的 AGENTS.override、AGENTS、CLAUDE 與 configured fallback files 仍以實體檔案為 canonical source，讓 Git、worktree、IDE 與原生 CLI 保持相容。SQLite 只保存這些檔案的索引、canonical path、revision、content hash、解析診斷及 Task run snapshot metadata，不成為可回寫的第二份專案內容。

Pi resource discovery 是唯一的 instruction discovery owner。Renderer 只編輯 DB-owned 資料、請求受約束的檔案操作並呈現 Host UI Projection，不自行合併可送往模型的第二份 prompt。每次 Task run 由唯一 admission 入口要求 Host 解析最新版全域指令、include 與專案層級，依固定 precedence 產生 immutable instruction snapshot；同一次 run 的後續迭代維持該 snapshot，設定或檔案變更從下一個 run 生效。模型可見的有效文字與來源證據寫入 Turn Record，使 settled、replay、context usage 與稽核使用同一事實來源。

「最先讀取」與「最高 authority」在產品中分開呈現：全域自訂指令先組裝，較具體的專案與較近工作目錄指令後組裝，當前請求最後緊鄰模型回應；衝突時則由受管政策／安全契約最高，其次是較近的 project override、project instructions、global custom instructions，最後才是 learned memory。使用者目前明確要求能否覆蓋全域預設，依較高層政策及自訂指令本身的預設語意判定，而不是讓 SQLite 內容取得不可限制的 system authority。

## User Stories

1. As an AgentStudio user, I want to find custom instructions under Personalization, so that the location matches the Codex Desktop mental model.
2. As an AgentStudio user, I want one global custom-instructions editor, so that I do not paste the same rules into every conversation.
3. As an AgentStudio user, I want global instructions to apply to every newly admitted Task run, so that behavior is consistent across projects.
4. As an AgentStudio user, I want personality presets to remain separate from behavioral instructions, so that changing tone does not silently change authority or capabilities.
5. As an advanced user, I want to edit an advanced personality instruction, so that I can define a stable Agent voice beyond a preset.
6. As an existing user, I want my current personality, about-user and response-style settings migrated without loss, so that upgrading does not reset personalization.
7. As an existing user, I want the legacy stable SOUL content migrated into the new Personalization model, so that an old customization remains effective.
8. As an existing user, I want the legacy internal AGENTS content migrated into global custom instructions, so that it is no longer mislabeled as a project file.
9. As a user, I want the duplicate Learning "人格與上下文" editor removed after migration, so that there is one obvious owner for customization.
10. As a project user, I want to see every instruction file discovered for the current project, so that I know what the Agent will receive.
11. As a project user, I want to distinguish global, project-root, parent and nearest-work-directory sources, so that scope is understandable.
12. As a project user, I want AGENTS.override to be visually distinguished from normal AGENTS files, so that override behavior is explicit.
13. As a project user, I want CLAUDE and configured fallback filenames shown as their real source type, so that compatibility is not hidden behind a generic label.
14. As a project user, I want project instruction files to remain ordinary files, so that Git, IDEs, branches and worktrees continue to work.
15. As a project user, I want to open an instruction source in the editor from Personalization, so that edits happen at the canonical source.
16. As a project user, I want an explicit create action when an instruction file is missing, so that the application never creates project policy unexpectedly.
17. As a project user, I want file edits made through AgentStudio to use atomic replacement, so that a crash cannot leave a partially written instruction.
18. As a user, I want a global custom instruction to include an explicitly named local instruction file, so that large reusable rules need not be duplicated.
19. As a user, I want an include failure to be visible before or during the next run, so that I never assume missing rules were applied.
20. As a user, I want include cycles detected, so that recursive references cannot hang or explode context assembly.
21. As a user, I want nested includes bounded by file count, depth and byte budgets, so that personalization cannot consume the whole context window.
22. As a security-conscious user, I want project-scoped includes prevented from escaping the canonical project unless explicitly authorized, so that an untrusted repository cannot silently load unrelated local files.
23. As a security-conscious user, I want symlinks canonicalized before scope checks, so that an include cannot bypass its allowed root.
24. As a user, I want all instruction content to pass through the Outbound Data Gate before reaching a remote provider, so that personalization does not become a data-exfiltration bypass.
25. As a user, I want Personalization to show the actual precedence order, so that "loaded first" is not confused with "highest authority".
26. As a user, I want the current task request placed after standing instructions, so that the immediate objective remains salient to the model.
27. As a user, I want project-specific instructions to override conflicting global defaults, so that repository conventions win where they apply.
28. As a user, I want a nearer work-directory instruction to override a broader project instruction, so that directory-specific conventions work predictably.
29. As an administrator, I want managed safety policy to remain above all user-editable instructions, so that Personalization cannot weaken deployment policy.
30. As a user, I want learned memory to remain below explicit instructions, so that an old inferred preference cannot override a current rule.
31. As a user, I want a Task run to freeze the resolved instruction revision at admission, so that behavior does not change halfway through execution.
32. As a user editing instructions during a run, I want the UI to say the change applies to the next run, so that lifecycle behavior is unsurprising.
33. As a user, I want every Loop iteration in one Task run to use the same instruction snapshot, so that Goal-based work remains coherent.
34. As a user, I want a new follow-up that creates a new Task run to use the latest committed settings, so that changes take effect without restarting the app.
35. As a user, I want a failed SQLite write to leave the previous committed instructions active, so that save failure cannot erase personalization.
36. As a user, I want an instruction database corruption state shown explicitly, so that unreadable storage is not mistaken for empty settings.
37. As a user, I want read-only recovery or export when safe, so that I can recover custom instructions from a degraded store.
38. As a user, I want Personalization export/import to include DB-owned instructions and metadata, so that I can move settings between installations deliberately.
39. As a user, I want project instruction files excluded from the exported database payload, so that an app export does not become a hidden copy of repository policy.
40. As a user, I want an import preview and atomic commit, so that existing instructions are not overwritten without seeing the result.
41. As a user, I want the UI to show source path, revision, content hash, byte count and truncation status, so that applied context is auditable.
42. As a user, I want a context-budget warning before oversized instructions are silently clipped, so that I can shorten or split them intentionally.
43. As a user, I want duplicate instruction text detected across global and project sources, so that context is not wasted on repeated rules.
44. As a user, I want the effective instruction snapshot represented in the Turn Record, so that replay can explain what the model actually saw.
45. As an auditor, I want the Turn Record to distinguish user-authored instructions, filesystem project instructions and Host resolution diagnostics, so that claims and Host facts do not collapse together.
46. As an auditor, I want the exact effective text reconstructable for a historical run, so that later edits do not rewrite the past.
47. As an auditor, I want include provenance retained transitively, so that an instruction imported through another file still has an accountable source.
48. As a user viewing context usage, I want personalization and project instruction bytes reported separately, so that I can understand context pressure.
49. As a user using a temporary chat, I want global and project instructions to remain available while durable memory stays disabled, so that temporary affects memory rather than safety or project policy.
50. As a user using builtin Pi, I want Host-owned instruction discovery and injection, so that renderer state cannot diverge from execution.
51. As a user using an external CLI, I want the UI to disclose whether instructions were explicitly delivered, natively discovered or could not be verified, so that parity is not falsely claimed.
52. As a user using Codex CLI, I want real AGENTS files to remain discoverable by Codex itself, so that AgentStudio does not break native behavior.
53. As a user using a provider with native instruction discovery, I want duplicate delivery avoided, so that the same large instruction is not injected twice.
54. As a maintainer, I want one resolver contract for global and filesystem instructions, so that precedence is not reimplemented in UI, runner and smoke code.
55. As a maintainer, I want the Instruction Repository separate from DurableMemoryStore, so that the memory authority and migration contract are not silently broadened.
56. As a maintainer, I want Pi resource discovery to remain the sole instruction discovery system, so that legacy Hermes loading does not return as a second owner.
57. As a maintainer, I want instruction changes published as monotonic Host revisions, so that renderer projections can invalidate and refetch safely.
58. As a maintainer, I want compare-and-swap semantics for concurrent edits, so that one window cannot silently overwrite a newer revision.
59. As a maintainer, I want SQLite success emitted only after transaction commit, so that UI confirmation always means durable state.
60. As a maintainer, I want graceful shutdown to drain writes and checkpoint WAL, so that the repository has a defined lifecycle.
61. As a maintainer, I want crash restart to recover the last committed instruction revision, so that incomplete saves never become live.
62. As a maintainer, I want bounded schema migration with a marker and backup, so that legacy personalization cutover is restart-safe.
63. As a maintainer, I want settings and Learning migration to be idempotent, so that repeated startup cannot duplicate or reapply old content.
64. As a maintainer, I want a drift guard preventing new renderer-owned prompt assembly, so that the Host remains the single owner.
65. As a maintainer, I want a drift guard preventing instruction tables from entering the durable-memory database, so that authority boundaries remain reviewable.
66. As a maintainer, I want all visible Personalization state rebuilt from a Host snapshot plus revision events, so that localStorage never becomes a second canonical store.
67. As a maintainer, I want actual model-visible instruction content accounted for before provider submission, so that ADR-0049 remains true.
68. As a maintainer, I want instruction delivery mode recorded per runner, so that external CLI limitations are testable and visible.
69. As a maintainer, I want fallback filenames configurable through a bounded validated list, so that compatibility does not permit arbitrary discovery rules.
70. As a maintainer, I want the default configuration to preserve existing AGENTS and CLAUDE discovery behavior, so that rollout does not regress current projects.

## Implementation Decisions

- **Single user-facing home.** Personalization is the sole normal settings entry for personality, about-user information, response preferences, global custom instructions, advanced personality instructions and current-project instruction sources. The legacy Learning prompt editor is removed after successful migration rather than kept as a second editor.
- **Separate meaning despite one UI.** Personality controls tone. Global custom instructions express cross-project user defaults. Project instructions express repository or directory policy. Persistent memory remains learned or recalled context. The UI labels and help text must not call a DB-owned global instruction a project AGENTS file.
- **Authority order.** Managed policy and non-user-editable safety/runtime contracts are highest. Among user-visible instruction sources, the nearest applicable project override wins, followed by nearer project instructions, broader project instructions, global custom instructions and learned memory. The current request is placed last for salience but does not acquire authority to defeat managed policy.
- **Assembly order.** The effective block is assembled global-to-specific, followed by the current request. Source headings and diagnostics preserve provenance. Ordering and conflict authority are documented separately so that "first read" is not represented as "unconditionally wins."
- **Host-owned Instruction Repository.** A deep Host module owns global custom instructions, advanced personality text, revisions, schema migration, transactions, recovery and projection. Production uses a dedicated SQLite database in WAL mode; an in-memory adapter implements the same asynchronous behavioral contract for deterministic contract tests.
- **Do not broaden durable memory.** Instruction tables do not enter the DurableMemoryStore database or protocol. The existing Memory Extension continues to own only durable cross-session memory. Sharing low-level SQLite utilities is permitted only when it does not merge authority, lifecycle, schema or protocol.
- **Hybrid canonical sources.** DB-owned global settings store their body in the Instruction Repository. AGENTS.override, AGENTS, CLAUDE and fallback documents remain filesystem-owned. The repository may index their canonical path, mtime-independent content hash, bytes, source kind and last observed revision, but never writes a shadow body that can later overwrite the file.
- **Pi resource discovery ownership.** Instruction discovery, include expansion and effective snapshot resolution live behind the Pi Host/resource boundary in accordance with the single resource discovery ADR. Renderer prompt builders stop owning behaviorally equivalent discovery and retain only browser-compatible degradation until its deletion gate is met.
- **Admission snapshot.** The sole Task run coordinator requests or references one resolved Host instruction snapshot after project/thread binding and before provider dispatch. Snapshot identity, project identity, work path, source revisions, effective hash and delivery mode are frozen into the admitted run. One run never hot-swaps instructions between iterations.
- **Latest-setting lifecycle.** A committed UI or filesystem change publishes a monotonic instruction revision event. Idle projections refetch immediately. Active runs show "next run" semantics. The next separately admitted run uses the latest committed revision without requiring application restart.
- **Turn Record fidelity.** A dedicated Host-authored record entry carries the effective model-visible instruction text plus bounded source metadata, hashes, revision and resolution diagnostics. Historical replay uses this entry rather than re-reading current SQLite rows or files, satisfying the rule that model-visible context is reconstructable from the Turn Record.
- **Context budgeting.** Global custom instructions and project guidance receive explicit separately reported budgets within the existing ContextPacket policy. Higher-authority sources are retained before lower-priority memory when the overall budget is exhausted. Per-source and total caps produce visible diagnostics rather than unreported truncation.
- **Includes.** A line-oriented include reference supports explicit local instruction reuse such as a user-configured absolute file. Resolution is Host-side, canonicalizes paths and symlinks, detects cycles, and enforces bounded depth, source count, individual bytes and total bytes. The effective snapshot records the complete transitive provenance.
- **Include trust boundary.** A global instruction authored through Personalization may include an explicit absolute local path. A project-owned document may include within its canonical project/worktree; an escape outside that root requires a durable explicit user authorization for that exact canonical target. Include content remains subject to the Outbound Data Gate.
- **Failure semantics.** Missing, unreadable, cyclic, unauthorized or oversized include sources produce typed, user-visible diagnostics and cannot be reported as applied. A configurable instruction failure does not silently become empty. Managed policy failures remain fail-closed; an ordinary optional user include may allow the run only after the UI and Turn Record identify the degraded instruction snapshot.
- **Filesystem writes.** Creating or editing project instruction files is an explicit action. Host validates the target against the current canonical project/worktree, uses compare-and-swap against the observed hash and performs atomic replacement. External edits win over stale UI drafts; conflicts require reload or deliberate reapply.
- **Discovery vocabulary.** Source kinds include managed, global-custom, personality, project-parent, project-root, project-directory, project-override and fallback. Configured fallback filenames are a bounded list of safe basenames, never arbitrary paths or globs.
- **Personalization projection.** Renderer receives a versioned projection containing DB-owned drafts, discovered filesystem summaries, effective order, diagnostics and revision. It does not receive a write-capable filesystem handle or maintain localStorage as canonical state.
- **Migration.** Existing personality, about-user and response-style values migrate into the new Host repository. Legacy SOUL migrates to advanced personality; legacy internal AGENTS migrates to global custom instructions. Migration is idempotent, preserves a backup/report, commits data and marker atomically, and removes legacy write paths only after qualification.
- **Export/import.** Personalization export contains DB-owned instruction records, schema version and integrity metadata, explicitly warning that content is plaintext user data. Filesystem project documents are represented only by optional source summaries, never copied into the bundle. Import is preview-first, validates schema and conflicts, then commits atomically.
- **External runners.** Every runner advertises an instruction delivery mode: explicit snapshot injection, native filesystem discovery, or unverified. Native discovery sources are not also prepended when that would duplicate content. Exact snapshot parity is claimed only for explicit delivery; native/unverified limitations remain visible in the run record and qualification evidence.
- **Security.** User-editable instructions cannot modify Approval Mode, bypass required approvals, weaken the Outbound Data Gate, grant tool capability, or become execution evidence. Instruction text is model input, not Host authority.
- **Architecture record.** Implementation must add or amend an ADR for the hybrid instruction authority and Task run snapshot lifecycle because it creates a new Host-owned SQLite authority and moves prompt discovery responsibility; this is not merely a UI preference field.
- **UI design discipline.** The Personalization surface extends the existing settings information architecture rather than introducing a competing top-level "instructions" product area. Source status uses clear typography and disclosure, not decorative chips for every metadata field. All controls remain visible without entrance-animation dependency, keyboard operable, and verified at narrow and desktop widths.

## Testing Decisions

- **Primary seam: admitted Task run through the real Pi Host.** The principal qualification starts the shipped Pi Host with an isolated instruction database and temporary project, writes global instructions through the public Host contract, creates project instruction files, admits a real builtin Task run and asserts the Turn Record's effective instruction entry, delivery order, source metadata, revision and context diagnostics. This is the highest existing seam and covers repository, discovery, admission, prompt delivery and record fidelity without inspecting private SQL tables.
- **Test external behavior, not implementation detail.** Normal behavior is asserted through public protocol responses, revision events, admitted run snapshots, Turn Record entries and renderer projections. Tests do not assert SQL statements, table layout, internal function call counts or duplicate resolver implementations in smoke code.
- **Shared repository contract.** The same behavioral suite runs against production SQLite and the in-memory adapter. It covers read, compare-and-swap write, monotonic revision, idempotency, migration, export/import preview, atomic commit, shutdown, restart and typed failures.
- **Resolver corpus.** A fixed temporary filesystem corpus covers global-only, project root, parent, nearest directory, override, CLAUDE, fallback, duplicate content, nested include, missing include, cycle, symlink escape, Unicode paths, Traditional Chinese/English content and every truncation boundary. Expected effective order is asserted at the public resolver/snapshot boundary.
- **Snapshot isolation scenario.** Admit run A, change both SQLite and a project file, continue run A, then admit run B. Run A must retain its original effective hash and text; run B must use the new committed revisions. A failed save must leave both runs on the last committed revision.
- **Turn Record reconstruction scenario.** After a run completes, modify and delete current sources, restart the Host and replay the run. The exact effective instruction text and provenance visible to the model must remain reconstructable from the record.
- **Outbound protection scenario.** Put classified protected text in a custom instruction and an included file, enable each deployment posture, and drive a real provider-preparation request. Effective protection must sanitize or block through the existing Outbound Data Gate; Personalization cannot bypass it.
- **Filesystem concurrency scenario.** Load a project instruction draft, modify the file externally, then attempt a stale UI save. The public write contract must return a conflict and preserve the external file. Atomic-write failure must leave the original content intact.
- **Crash and recovery evidence.** Acknowledged SQLite writes survive immediate Host termination and restart. Uncommitted migration/save operations do not become live. Corruption, unsupported schema, read-only storage, disk failure and busy timeout never emit a success revision.
- **Migration scenario.** Fixtures for every supported legacy combination verify one-time migration, restart idempotency, preservation of empty-versus-missing semantics, backup/report creation and removal of legacy writes after cutover.
- **Renderer behavior.** A focused browser/Electron smoke opens Personalization, edits and saves global instructions, inspects project sources, triggers a conflict, observes include/truncation diagnostics, and verifies keyboard and responsive behavior. The test asserts user-visible outcomes and IPC-backed projection, not component state.
- **External CLI qualification.** Adapter contract tests assert delivery-mode disclosure and duplicate suppression. Real installed Codex and Claude qualification verifies native discovery and the visible limitation boundary; absent providers remain explicitly unqualified rather than simulated as parity.
- **Prior art.** Reuse the shipped-module smoke convention, real Pi Host protocol harness, durable SQLite lifecycle/restart tests, ContextPacket behavior tests, context usage projection tests, Turn Record reconstruction rules and tracker-link drift guard already present in the repository.
- **Drift guards.** Add source-level guards only for architecture invariants that behavioral tests cannot cheaply prove: no new renderer-owned production instruction resolver, no instruction schema in DurableMemoryStore, one Task run admission path, and no second model-visible history stream.
- **Release gate.** Completion requires build, focused instruction qualification, the full smoke chain, migration/restart evidence and a point-by-point UI review under the repository's anti-slop design law. A green low-level contract alone is insufficient.

## Out of Scope

- Changing managed company policy, system safety messages or their deployment authority.
- Allowing user instructions to bypass Approval Mode, tool approvals, sandboxing, capability restrictions or the Outbound Data Gate.
- Moving Pi sessions, transcripts, compaction, queue, attachments or long-term memories into the new instruction database.
- Moving project AGENTS／CLAUDE bodies exclusively into SQLite or replacing their Git/worktree semantics.
- Making learned durable memory equivalent to explicit custom instructions.
- Treating instruction text as execution evidence or as proof that a requested side effect occurred.
- Guaranteeing exact native instruction snapshot parity for an external CLI that exposes no way to freeze or report its discovery; such a runner must remain visibly native/unverified.
- Implementing cloud sync, team-shared instruction policy, account login or organization administration.
- Fetching remote HTTP include targets. Includes are local files only in this effort.
- Automatically creating or rewriting project instruction files without an explicit user action.
- Adding a second top-level navigation destination that duplicates Personalization.
- Redesigning unrelated Settings, Learning, Memory or Pi Core screens.

## Further Notes

- The requested Codex Desktop alignment is an information-architecture decision: users configure global instructions under Personalization. It does not imply that all instruction sources share one storage authority.
- The sample instruction begins with an absolute local include and then contains a very large design law. It is the motivating compatibility case for bounded include expansion, visible context-budget diagnostics and deduplication; the sample content itself is reference data, not a command executed while producing this spec.
- Large instructions should be supported but not encouraged as one monolithic prompt. The UI should expose byte and budget pressure, while reusable procedural content may later be moved into Skills through the existing Pi resource system. That later authoring recommendation does not change this effort's requirement to preserve the user's current instruction faithfully.
- The test seam is considered confirmed from the conversation because the user requested direct synthesis with no interview: admission through the real Pi Host is the single highest seam that can prove the promised behavior end to end.
- 2026-08-30 本機 implementation、build、完整 smoke、real Pi Host E2E 與 anti-slop UI qualification 已完成；一 hop 證據見 [qualification.md](qualification.md)。
- 本 spec 維持 `Status: 待補資訊`：[#11](issues/11-external-cli-instruction-delivery-modes.md) 尚缺外部 native-discovery 真機證據（Codex `native_discovery_unproven`；Claude `auth_unavailable`），因此 tracker 與 DEV_STATE 均不得提前標為 resolved。
