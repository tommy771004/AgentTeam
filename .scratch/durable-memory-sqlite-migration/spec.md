# 長期記憶 JSON → SQLite 遷移

> 狀態：`可交給代理`

## Problem Statement

目前 production 的長期記憶由 Pi Core Host 內的 Memory Extension 管理，但實際資料仍放在 Host 記憶體陣列，並與 sessions、settings、queue、resources、extensions、attachments 一起序列化進同一份 `pi-host-state.json`。每次修改會重寫整份 snapshot，Host 回覆成功時也不代表資料已真正落盤。這讓長期記憶缺少清楚的 durability、transaction、scope、migration 與 failure contract。

現況不只是儲存格式問題：

- runtime recall 沒有強制帶入目前 project scope，可能讀到其他專案的記憶；只以 id 取值也無法證明呼叫者有權讀取該 scope。
- logical key 同時被當成資料列 id；兩個專案使用相同 key 時會互相覆蓋。
- run admission 已凍結 `memoryEnabled`、`memoryWriteEnabled`、temporary 與 project，但實際寫入沒有在單一 Host authority 完整執行這些政策。
- automatic learning、明確的「請記住」、手動管理、Dream consolidation 與匯入的 commit 時點不同，現行生命週期沒有把這些差異定義成可驗證契約。
- retry 可能讓 append 重複；失敗、取消、denied 或未達 DoD 的 run 也缺少一致的「不得自動寫入」保證。
- renderer 是 UI Projection，卻仍保有會與 Host canonical state 漂移的記憶副本；Host 寫入事件也不會讓 Learning UI 可靠地重新抓取最新資料。
- production 匯出仍讀取 legacy memory source，而非 Pi Host canonical memories，因此 backup／restore 不能保證包含使用者真正的長期記憶。
- validation、quota、retention、provenance、corruption recovery 與多 process contention 都沒有集中在一個深模組內。

本機現有 `pi-host-state.json` 約 5 MB，但其中主要是 sessions，memories 為 0。只遷移長期記憶不會顯著縮小這個現有檔案；這個 effort 的價值是建立正確的 durable-memory authority 與生命週期，不是假稱已解決所有 Pi session state 的體積問題。Pi sessions、transcripts 與 context compaction 仍由 Pi Core 擁有，符合 ADR-0035。

## Solution

建立 Host-owned 的 `DurableMemoryStore` 深模組，作為 Memory Extension 唯一的長期記憶 authority。它以 async contract 隱藏 SQLite schema、migration、scope enforcement、ranking、validation、quota、idempotency、transaction、consolidation、export/import 與 shutdown；production 使用 SQLite adapter，測試使用同契約的 in-memory adapter。renderer、Memory Pack 與其他 Extension Pack 都只能經由 Pi Host memory protocol 使用它，不保存可回寫的第二份 canonical memories。

SQLite 資料庫保存具 scope 的 memory entries、normalized tags、provenance、revision/content hash、idempotency operation、migration marker 與必要的 metadata-only audit。global memories 與 project memories 是明確不同的 scope；普通 runtime 只能讀取「目前 canonical project + global」，管理 UI 才能列出跨專案資料。固定的使用者 profile 與 memory document 維持 global、always-recall 的特殊語意。

所有寫入先完成 transaction commit，才回覆 tool／IPC success 並發布 `memory/changed` revision event。Host 啟動時先開啟、驗證並遷移 memory database，成功後才宣告 ready；關閉時 drain writes、checkpoint WAL、close。crash 由 SQLite WAL recovery 接手，corruption 或 migration failure 必須進入可見的 degraded state，不能把「讀不到」誤判成「沒有記憶」後覆寫資料。

renderer 只保留 paged UI Projection，收到 revision event 後 invalidate/refetch。Dream consolidation 改為 Host 內的一個 atomic memory transaction。匯出／匯入也走同一個 Host memory interface，使用 versioned bundle、預覽與 conflict mode，不再從 legacy renderer storage 猜測 canonical data。

這個 effort 採保守的 runner parity：只有具備相同 scoped recall 與 policy enforcement 的 runtime 可以自動寫入 shared long-term memory。External CLI 在尚未得到同等 recall contract 前停止 automatic memory write；手動管理不受影響。未來若要讓 External CLI 收到 bounded memory packet，另立 effort。

## User Stories

1. As a task conversation user, I want memories from one project to stay isolated from another project, so that unrelated or confidential context is not recalled into the wrong task.
2. As a task conversation user, I want global profile memories to remain available across projects, so that stable preferences do not need to be repeated.
3. As a task conversation user, I want temporary conversations to neither read nor write durable memory, so that temporary really means non-persistent.
4. As a task conversation user, I want disabling memory to prevent recall, so that the per-run setting is authoritative.
5. As a task conversation user, I want disabling memory writes to prevent explicit and automatic runtime writes, so that the run cannot bypass my selected policy.
6. As a task conversation user, I want an explicit “remember this” request to be durable once the app says it succeeded, so that a restart cannot silently lose it.
7. As a task conversation user, I want failed, cancelled, denied, or incomplete runs not to create automatic memories, so that unsuccessful work does not become trusted future context.
8. As a task conversation user, I want automatic learning to be recorded only after final success and DoD, so that stored conclusions reflect completed work.
9. As a task conversation user, I want retries to avoid duplicate appended memories, so that transient transport failure does not pollute recall.
10. As a task conversation user, I want the same logical memory key to coexist in different projects, so that one project cannot overwrite another.
11. As a task conversation user, I want memory recall to preserve the current ranking behavior during storage migration, so that changing databases does not unexpectedly change answers.
12. As a Traditional Chinese user, I want recall, tags and search to handle CJK and Unicode consistently, so that migration does not favor English-only content.
13. As a user editing profile or memory document settings, I want those global always-recall entries to retain their special behavior, so that the new store does not break current personalization.
14. As a Learning page user, I want a memory written by a running task to appear without navigating away and back, so that the UI reflects Host truth promptly.
15. As a Learning page user, I want deleting or consolidating memories to update every projection, so that removed content cannot reappear from stale renderer state.
16. As a Learning page user, I want paginated lists instead of loading every memory into the renderer, so that the page remains responsive as memory grows.
17. As a user managing memories, I want to clear one project, global memories, or all memories as distinct confirmed actions, so that a broad delete is never accidental.
18. As a user exporting settings, I want the bundle to contain the actual canonical long-term memories, so that backup represents what the app will recall.
19. As a user importing memories, I want a preview and explicit conflict policy, so that existing entries are not silently overwritten.
20. As a user deleting sensitive memory, I want the documented hard-delete policy to cover the database and WAL lifecycle, so that deletion claims are honest.
21. As a security-conscious user, I want secrets sanitized before persistence and recalled memory treated as untrusted context, so that memory cannot become a credential vault or an instruction bypass.
22. As a user whose database is corrupted, I want a visible degraded state and recovery path, so that the app never resets my memory silently.
23. As a user upgrading from the JSON-backed version, I want migration to be atomic and restart-safe, so that a crash cannot leave two partial authorities.
24. As a user downgrading after migration, I want the app to refuse an unsafe silent downgrade, so that an older version cannot overwrite newer canonical memory.
25. As a user running more than one app process, I want concurrent writes to remain serialized and conflict-safe, so that the database stays valid.
26. As a user closing the app immediately after a memory write, I want acknowledged data to survive shutdown, so that success has a clear durability meaning.
27. As a task conversation user, I want recalled memory provenance to be traceable to its source run or manual action, so that I can understand why it exists.
28. As a task conversation user, I want the Turn Record to identify which memory revisions were recalled, so that a past answer can be audited without copying the full private memory into the timeline.
29. As a privacy-conscious user, I want deleted content omitted from audit metadata, so that auditability does not retain the very text I removed.
30. As a maintainer, I want one Host memory authority rather than renderer/pack copies, so that lifecycle fixes happen once.
31. As a maintainer, I want the storage implementation replaceable behind one async seam, so that tests do not depend on SQL layout.
32. As a maintainer, I want schema migrations to be monotonic and recorded, so that upgrades are deterministic and diagnosable.
33. As a maintainer, I want invalid legacy rows quarantined and reported rather than crashing or disappearing, so that migration loss is measurable.
34. As a maintainer, I want quotas and validation centralized at the authority boundary, so that every write origin receives identical protection.
35. As a maintainer, I want automatic retention and Dream consolidation to be transactional, so that merged entries and removals cannot land half-complete.
36. As a maintainer, I want External CLI automatic writes disabled until recall parity exists, so that shared memory cannot be shaped by a runner that never consumes it.
37. As a maintainer, I want corruption, lock contention and disk-full errors surfaced as typed failures, so that callers never report a false success.
38. As a maintainer, I want production SQLite and in-memory test adapters to satisfy the same behavioral contract, so that the seam is real rather than a test-only fake.

## Implementation Decisions

**Authority and seam.** `DurableMemoryStore` is owned by the Pi Core Host Memory Extension and is the only mutation authority. The Pi Host memory protocol is the highest external seam. renderer Zustand state is a disposable UI Projection; Extension Packs receive services, not mutable arrays or database handles.

**Storage boundary.** Production uses the Node runtime's SQLite support rather than the vendored Pi session repository. The latter belongs to Pi sessions and must not become a disguised second owner for SubAgents long-term memory. A separate in-memory adapter implements the same async contract for deterministic interface tests.

**Scope-aware identity.** Every entry has a synthetic primary identity and a logical key unique within its scope. Project scope uses a canonicalized project identity; global scope has no project. Symlinks, path case rules where applicable, separators and trailing slashes are normalized before any access decision. Same logical key in two projects is valid and isolated.

**Runtime access context.** Every runtime read and write carries a frozen access context containing canonical project, run/session identity, memory-read setting, memory-write setting, temporary status and origin. Runtime recall sees only global plus its current project. Administrative list/export operations use a separate explicit origin and cannot be reached by ordinary tool calls.

**Policy at the authority boundary.** The Memory module centrally enforces memory disabled, write disabled, temporary, scope and allowed origin. Packs may perform early UX checks, but those checks are not security or lifecycle evidence. Runtime tools cannot clear another scope or enumerate all projects.

**Commit points.** Manual administrative edits commit immediately. A successful `memory_set` or `memory_append` commits before its tool result reports success. Explicit “remember” commits after successful interpretation/response settlement and uses a deterministic source operation. Automatic learning commits only after final success and DoD met. Failed, cancelled, denied, interrupted or non-DoD runs produce no automatic write. Consolidation and import each commit as one atomic transaction.

**Idempotency.** Runtime writes carry a deterministic operation identity derived from their owning run and tool call or explicit learning source. The store records completed operations under a uniqueness constraint and returns the existing result on retry. Operation identities use an unambiguous tuple; callers preserve the original payload, including its timestamp, across retries. Reusing an identity with a different payload fails closed. A delayed retry returns the currently surviving entry without rewriting it; if that identity has been deleted, it returns `not_found` rather than restoring or replaying deleted content. Journals retain hashes and identities, not historical memory text. Append never uses randomness as its only duplicate defense.

**Schema shape.** The database separates memory entries, normalized tags, idempotency operations, schema migrations and optional metadata-only events. Entries record logical key, scope, content, source kind, source session/run/call, timestamps, status, revision and content hash. Indexes serve scope, time and tag queries. A full-text index may be present only if its Traditional Chinese and Unicode behavior meets the defined parity fixtures; storage migration does not depend on English tokenization.

**Retrieval parity first.** The first cut preserves existing always-recall, recency, tag and text-ranking behavior. Decay remains presentation metadata rather than silently changing rank. Candidate retrieval may use SQL indexes or FTS, but the observable ordering must match the current contract for the parity corpus. Ranking redesign is a separate product change.

**Bounded data.** Central validation limits entry text, logical key, tag count/length, timestamp validity, import batch size and query page size. Per-project and global quotas are explicit and return typed failures. Retention and consolidation can mark superseded entries and reclaim them according to a documented policy; decay alone never implies deletion.

**Durability.** SQLite runs in WAL mode with an explicit busy timeout, serialized Host writes and transactions. Success is emitted only after commit. Host shutdown drains accepted writes, checkpoints WAL and closes; crash recovery relies on committed WAL state. Disk-full, busy-timeout and I/O failures are returned as typed failures without publishing a success event.

**Change projection.** Every successful mutation increments a monotonic store revision and publishes a `memory/changed` event containing revision, entry identity and action but not private content. renderer compares revisions, invalidates affected pages and refetches. It never syncs a local memory collection back into Host truth.

**Consolidation.** Dream consolidation moves inside the Host memory module and performs source reads, merged write, supersede/delete decisions and revision publication within one transaction. There is no renderer-side two-way sync.

**Export and import.** Versioned export is produced from the canonical Host store. Import parses and validates into a staging representation, returns a preview with add/update/conflict/invalid counts, and applies the selected conflict mode atomically. Export files warn that memory content is plaintext user data and receive restrictive file permissions where supported.

**Migration and cutover.** On first compatible startup, Host validates the old JSON snapshot, backs it up, opens the memory database and imports valid memories plus the migration marker in one SQLite transaction. Invalid rows are quarantined/reported. Only after the commit does the Host advance its state schema and stop treating JSON memories as live. There is no dual-write period. A crash before commit retries from JSON; a crash after commit recognizes the marker and never duplicates rows.

**Downgrade.** Once the Host state records the SQLite memory authority, an older incompatible app must fail closed with an actionable message or require an explicit compatible export. It must never silently resume JSON writes. The backup is recovery evidence, not a second live authority.

**Corruption.** JSON parse failure, SQLite integrity failure and unsupported schema version are distinct degraded states. The Host does not replace corrupt storage with an empty database. Read-only export/recovery may remain available when safe; runtime recall/write fails visibly until repaired.

**Security and privacy.** Durable memory remains local plaintext, like the current JSON; this effort does not claim encryption at rest. The authority applies secret/protected-data sanitization before storage, restrictive database permissions, bounded untrusted-context injection and explicit hard-delete/WAL checkpoint behavior. Deleted-content audit is forbidden; metadata-only provenance may remain if it cannot reconstruct the content.

**Turn Record provenance.** Each builtin Pi turn records the recalled memory identities and store revision as bounded execution metadata, not full memory text. This provides reproducibility without duplicating durable content into the timeline.

**Runner parity.** Builtin Pi retains scoped recall and approved writes. External CLI automatic learning into the shared store is disabled until that runner has an equivalent bounded recall and policy contract. This is a deliberate safety behavior, not a temporary renderer fallback.

**Protocol evolution.** Removing full memories from the Host snapshot and adding paged memory operations, health, revision events, import/export and lifecycle failures is a versioned Pi Host Protocol change. Negotiation must fail closed for clients that assume the prior snapshot shape.

**Architecture record.** ADR-0035 already fixes the important ownership decision: Pi owns sessions/compaction; the Memory Extension owns durable cross-session memory. SQLite is an implementation and protocol evolution under that boundary, so no new ADR is required unless implementation attempts to move session ownership, create a second memory authority or change the renderer projection model.

## Testing Decisions

**Primary seam: real Pi Host memory protocol.** The principal smoke starts a real Pi Core Host with an isolated temporary state directory and memory database, invokes only the public memory protocol, restarts the Host, and asserts observable responses/events. Tests do not inspect private SQL tables to prove normal behavior. This is the highest existing seam and covers protocol, Memory Extension, production SQLite adapter, persistence and lifecycle together.

**Shared adapter contract.** A deterministic contract suite runs against both the SQLite adapter and in-memory adapter. It covers scope isolation, global recall, identity, upsert, append idempotency, pagination, validation, quota, revision, consolidation, delete/clear and typed failure behavior. The suite asserts results, not SQL statements or implementation call counts.

**Migration fixtures.** Versioned fixtures cover empty v1/v2 state, normal memories, duplicate ids, same key across projects, special global profile/document entries, malformed dates, oversized content, invalid tags, partially corrupt rows and a wholly corrupt JSON file. Fault injection covers crash before transaction commit, crash after commit but before JSON schema update, and restart after completed cutover. Every case proves one authority and no duplicate import.

**Scope and policy matrix.** Protocol tests cross global/current/other-project scope with memory enabled/disabled, write enabled/disabled, temporary/non-temporary and runtime/admin/migration origins. `get`, search, set, append, delete and clear must all fail closed consistently; testing only search is insufficient.

**Run lifecycle matrix.** Existing run-lifecycle smokes are extended for explicit remember, tool set/append and automatic learning across success+DoD, success without DoD, failed, cancelled, denied, interrupted and retried outcomes. They assert the defined commit points and prove that no earlier stage wrote durable memory.

**Durability evidence.** A write acknowledgement is followed by immediate process termination and restart; the entry must exist. Disk-full, read-only directory, lock contention/busy timeout and forced close errors must never produce success or a `memory/changed` event. Two Host processes against one test database exercise SQLite uniqueness and busy handling without corrupting state.

**Retrieval parity corpus.** A fixed corpus covers Traditional Chinese, mixed Traditional Chinese/English, Unicode normalization, case, tags, project/global merging, always-recall entries, recency and current decay metadata. The JSON-era expected order is captured before cutover; SQLite candidate retrieval must produce the same bounded result order.

**Projection lifecycle.** A Host write publishes one revision event; a renderer projection fixture invalidates/refetches and shows the change without navigation. Duplicate/out-of-order events are harmless, revision never moves backward, delete and consolidation cannot be resurrected by stale renderer state, and plain-browser feature detection still degrades safely.

**Consolidation.** Fault injection at every internal consolidation stage proves all-or-nothing merged content, source status and revision. Renderer stores are not used as fixtures or mutation inputs.

**Export/import.** Round-trip tests cover all scopes, special global entries, tags and provenance. Preview counts, skip/overwrite/rename conflict modes, invalid batch rejection, quota enforcement and atomic rollback are observable through the Host protocol. Legacy renderer storage is deliberately absent from the fixture.

**Privacy.** Fixtures verify sanitizer enforcement, bounded untrusted-context wrapping, no memory content in revision events, no deleted text in audit metadata, restrictive database permissions where the platform supports them, and documented WAL checkpoint behavior after hard delete.

**Turn Record.** A real builtin Pi turn proves that recalled identity/revision metadata is recorded while full private memory content is not duplicated. External CLI tests prove it cannot automatically write shared memory until recall parity is introduced.

**Qualification.** The existing Pi Host memory smoke and memory-context smoke are strengthened rather than replaced with parallel test-only logic. The repository build, lint and full smoke chain remain green. Any source-text drift guard is repointed to the new authority rather than weakened.

## Out of Scope

- Migrating Pi sessions, transcripts, settings, queue, resources, extensions or attachments to SQLite.
- Reducing the current 5 MB Host state file when that size is predominantly session history.
- Replacing Pi Core session compaction or implementing pai-acp, pi-smart-compact, pi-context, Hypa or pi-press behavior.
- Vector databases, embeddings or semantic search.
- Cross-device sync, cloud backup or collaborative memory.
- SQLCipher or another encryption-at-rest system; honest plaintext handling, permissions and sanitization remain in scope.
- Changing recall ranking, decay semantics or adding autonomous forgetting beyond the retention/consolidation contract.
- Giving External CLI runners a bounded recall packet; this effort only disables their asymmetric automatic writes.
- Removing the plain-browser compatibility seam or unrelated legacy memory code before inbound callers are independently verified.
- Migrating Pi's vendored session repository or combining SubAgents memory tables with Pi session tables.
- App-wide single-instance UX. The memory store must remain concurrency-safe even if that is addressed separately.
- A general-purpose event-sourcing system for all Host state.

## Further Notes

- The intended lifecycle is: Host starts → opens and validates SQLite → performs restart-safe migration if needed → declares ready → serves scoped reads/writes → commits before success → publishes revision → renderer invalidates/refetches → shutdown drains/checkpoints/closes. Crash recovery resumes from the last committed transaction.
- Durable memory and context compaction are related only at context assembly time. Compaction decides which turn history remains in a Pi session; durable memory decides which curated cross-session facts may be recalled. They must not share a persistence owner or lifecycle.
- `profile:user` and `memory:document` remain global always-recall concepts managed through Settings. They may share the physical table but retain explicit kinds and policy; they are not ordinary project keys.
- FTS5 is available in the current Electron runtime, but availability is not proof of Traditional Chinese retrieval parity. The parity corpus decides whether FTS participates in phase one.
- The database, WAL and export contain plaintext user content. Product copy and support documentation must not imply encryption.
- The first implementation step should capture the current JSON retrieval-order corpus and define the protocol-level store contract before moving data. This prevents a storage migration from accidentally becoming a ranking redesign.
- Tickets preserve the single `DurableMemoryStore` seam and use expand–migrate–contract sequencing; every workflow converges on one protocol-level qualification ticket before the effort can close.

## Tickets

| # | Ticket | Blocked by |
|---|--------|-----------|
| 01 | [DurableMemoryStore 契約與 retrieval parity](issues/01-store-contract-and-retrieval-parity.md) | — |
| 02 | [SQLite 記憶的 Host protocol vertical slice](issues/02-sqlite-host-protocol-slice.md) | 01 |
| 03 | [Authority boundary 的 scope、policy 與 idempotency](issues/03-authority-policy-and-idempotency.md) | 02 |
| 04 | [JSON → SQLite 原子遷移與 authority cutover](issues/04-atomic-json-sqlite-cutover.md) | 03 |
| 05 | [Builtin Pi scoped recall 與 Turn Record provenance](issues/05-builtin-recall-and-turn-record.md) | 04 |
| 06 | [Memory Pack 工具完整遷移](issues/06-memory-pack-tools-cutover.md) | 04, 05 |
| 07 | [Task run learning 的結算生命週期](issues/07-run-learning-settlement.md) | 04 |
| 08 | [Learning／Settings 即時 Host UI Projection](issues/08-learning-settings-projection.md) | 04 |
| 09 | [Scoped clear、hard delete 與確認 UX](issues/09-scoped-clear-and-hard-delete.md) | 03, 08 |
| 10 | [Dream consolidation 的 Host transaction](issues/10-host-dream-consolidation.md) | 04, 08 |
| 11 | [Canonical memory export](issues/11-canonical-memory-export.md) | 04, 08 |
| 12 | [Preview-first atomic memory import](issues/12-preview-first-atomic-import.md) | 03, 04, 08, 11 |
| 13 | [Host storage lifecycle、corruption 與 downgrade](issues/13-host-storage-lifecycle.md) | 04 |
| 14 | [Durability、並行與 privacy failure matrix](issues/14-durability-concurrency-privacy-matrix.md) | 06, 07, 09–13 |
| 15 | [Contract 舊 JSON 與 renderer memory owners](issues/15-contract-legacy-memory-owners.md) | 05–14 |
| 16 | [全 workflow qualification 與 tracker 收口](issues/16-workflow-qualification.md) | 15 |

**開工順序：** 01–07 已 resolved；08、13 是目前可並行 frontier，09–12 接各自的 UI／export 前置，14 統合 failure matrix，15 才 contract 舊 owners，16 最終 qualification。每張票依 `origin → access policy → Host authority → transaction/commit → event/revision → renderer projection → restart/export → smoke` 檢查其適用的 workflow 節點，避免只改上游而漏掉下游。
