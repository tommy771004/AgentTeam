# 執行信任邊界加固（post-review）

Status: resolved

## Problem Statement

使用者已開始依賴 Task run 的「唯一結果、正確核准、誠實終態」契約，但第一輪 trust 落地後的 code review 顯示：在 opt-in 並行、generic MCP、以及 simulation／降級路徑上仍可能出現可被誤信的結果。

具體風險包括：同一 `runId` 在 admission 與標記 active 之間的競態下可能被接納兩次；終態 finalization 若被呼叫兩次仍可能重複 Archive／`onSettled`／queue drain；Archive 若先看見 `success` 狀態可能忽略非 verified 的 execution evidence；MCP 雖已依目標工具名分類，但宣告的 server／tool metadata 尚未參與決策，且「核准前不得傳輸」缺乏可觀測的回歸；simulation／degraded 在 Archive 有區分，但執行畫面未必讓使用者一眼看出「這不是已驗證成功」。

若這些縫未封，使用者仍可能對錯誤的工作按停止、對錯誤的提問作答、或把未驗證的 Definition of Done 當成真實完成。

## Solution

在既有 trust 契約之上做一輪**加固**，不重新發明第二套 lifecycle：以三個公開 seam 收斂 review 缺口——(1) Task run lifecycle 的 atomic admit 與 re-entrant finalize，且由 coordinator 擁有 terminal guard；(2) MCP 副作用依目標工具名**與可用 metadata** 分類，並以可觀測方式證明寫入在核准前不傳輸；(3) execution evidence 誠實性貫穿終態、Archive 與 run presentation，使 simulation／degraded 永遠無法被呈現或封存為 verified success。

第一輪已完成的能力（question FIFO、workspace list 唯讀、基礎 evidence 閘門、scenario duplicate 測試）保留為先決條件；本 spec 只補齊「在並行與邊界條件下仍成立」與「可觀測回歸」部分。

## User Stories

1. As a 使用者, I want a duplicate `runId` submitted while the first admission is still mid-flight to never start a second Loop run, so that opt-in concurrency cannot double-apply the same work.
2. As a 使用者, I want a duplicate `runId` after finalization to always receive a non-success duplicate outcome, so that retries with a reused identity cannot rewrite history.
3. As a 使用者, I want finalization for one `runId` to run its Archive / settlement / capacity release / queue drain effects at most once, so that automation and audit stay trustworthy.
4. As a 開發者, I want the coordinator to own admission and terminal-state guards for Task runs, so that the product has one lifecycle authority instead of split ownership across adapters.
5. As a 使用者, I want concurrent admissions of different `runId`s to keep working under the existing capped concurrency policy, so that exactly-once does not reintroduce a global single-run lock.
6. As a 使用者, I want interactive and automation sources to share the same duplicate and double-finalize guarantees, so that schedules and composer retries cannot diverge.
7. As a 使用者, I want a generic MCP call whose target tool is declared write/destructive/external in metadata to require approval under default auto mode, so that server-declared danger is not ignored.
8. As a 使用者, I want a generic MCP call with missing metadata but a write-like target name to still require approval, so that unknown surfaces stay conservative.
9. As a 使用者, I want a read-like MCP target with explicit read metadata to remain non-write for auto-mode gating, so that harmless probes are not blocked unnecessarily.
10. As a 使用者, I want unattended Task runs to still be unable to silently approve MCP writes, so that scheduled work cannot mutate external systems without a human.
11. As a reviewer, I want a test fixture that proves no MCP transport call occurs before required approval is granted, so that the safety claim is observable rather than inferred from call order in source.
12. As a 使用者, I want explicit full-access mode to remain deliberate and logged when it auto-approves a write-like MCP target, so that policy choice is not confused with a bypass bug.
13. As a 使用者, I want deny rules to still beat approval mode and metadata classification, so that hardening cannot weaken existing deny precedence.
14. As a 使用者, I want a Loop run that only ever produced simulation evidence to finish without claiming Definition of Done success, so that offline demos cannot train false confidence.
15. As a 使用者, I want a Loop run that degraded after LLM transport or DoD validator failure to finish without success Learning or success Archive semantics, so that later behaviour is not trained on false wins.
16. As a 使用者, I want Archive records to store and honour execution evidence such that a non-verified run cannot appear as archive success even if a transient status string says success, so that history stays honest under bugs.
17. As a 使用者, I want the execution / run presentation surface to show whether the current or last Loop run is verified, simulated, or degraded, so that I do not need to reconstruct trust from log lines alone.
18. As a 使用者, I want degraded and simulation outcomes to keep a diagnostic reason and a clear retry path, so that I know what failed and how to continue safely.
19. As a 使用者, I want two concurrent Loop runs that each ask a human question to keep FIFO presentation while resolve or timeout of one never settles the other, so that parallel work stays isolated end-to-end.
20. As a 使用者, I want stopping one Loop run to cancel only that run’s pending questions and permissions, so that sibling runs continue unaffected.
21. As a 操作者, I want every terminal transition for a `runId` to remain auditable exactly once, so that queue drain and schedule settlement do not double-fire.
22. As a 開發者, I want the three hardening seams to extend existing smoke and scenario harnesses, so that we do not invent a parallel test runner.
23. As a 開發者, I want production-module pure helpers for lifecycle decision and evidence mapping to stay the single source of truth used by runtime code, so that smoke mirrors cannot drift.
24. As a reviewer, I want negative tests that attempt concurrent duplicate admit, double finalize, metadata-backed MCP write, and forced success-with-simulation-evidence, so that regressions are caught before release.
25. As a product owner, I want this hardening not to change default single-run behaviour or ADR-0003’s opt-in cap, so that concurrency rollout policy stays intact.
26. As a product owner, I want workspace list to remain read-only as already shipped, so that this work does not reopen filesystem create-on-list.
27. As a support user, I want failure and simulation reasons preserved on the run and in Archive, so that I can explain why a Task run did not certify DoD.
28. As a 使用者, I want success notifications and success-only Learning to fire only for verified successful Loop runs, so that product side effects match trustworthy evidence.
29. As a 開發者, I want admission to be atomic with respect to the terminal registry (check-and-mark without an unprotected window after await gaps), so that TOCTOU cannot open a second owner.
30. As a 開發者, I want finalize to be idempotent for an already-finalized `runId`, so that accidental double entry cannot duplicate side effects.
31. As a 使用者, I want long-lived sessions not to silently forget finalized `runId`s in a way that allows re-admission of the same identity as a fresh success path, so that “never re-admit” holds for product-relevant windows (bounded retention must not resurrect success).
32. As a QA user, I want scenario E2E coverage for interactive and automation sources on the lifecycle seam, so that both composer retry and schedule rebind stay safe.

## Implementation Decisions

- **Three public seams only** (confirmed):
  1. **Task run lifecycle** — atomic admission + re-entrant／idempotent finalization; coordinator is the sole owner of the terminal-state guard keyed by `runId`.
  2. **MCP side-effect classification** — target tool name plus declared metadata when available; approval-before-transport must be observable in tests.
  3. **Execution evidence honesty** — terminal status, Archive mapping, and run presentation all refuse to treat non-verified evidence as success.

- **Lifecycle ownership:** Move or centralize admit decision and active/finalized registry operations so adapters do not own a parallel guard. Busy policy, capacity reservation, queue, and steer remain as today; this work only closes duplicate-owner and double-finalize holes.

- **Atomic admit:** The decision “is this `runId` absent?” and the transition to active must not leave an await gap where a second concurrent `runTask` with the same `runId` can also admit. Duplicate outcomes stay non-success, carry the existing run identity and reason, and must not dispatch a second Loop run, write a second user bubble, or call `onSettled` for the duplicate path.

- **Idempotent finalize:** Once a `runId` is finalized, further finalize attempts are no-ops for Archive, `onSettled`, capacity release, and queue drain (or return the prior terminal result without re-running side effects).

- **Retention:** Any bound on remembered finalized ids must not re-open a success path for a recycled `runId` within a realistic product session; if eviction is required, re-admission of an evicted id must still be treated conservatively (non-success or new identity policy documented in tests). Prefer failing closed over silent re-success.

- **MCP metadata:** When server or tool package metadata supplies an operation class (or equivalent), that class participates in write-like classification. Name heuristics remain the fallback for missing metadata. Deny precedence and unattended downgrade of full-access remain unchanged.

- **Approval-before-transport:** Keep authorize-before-execute order; add a fixture seam where a fake MCP transport records calls so tests can assert zero transport for denied／pending write-like invocations.

- **Evidence mapping:** Archive status derivation must consult evidence before honouring a bare `success` status string when evidence is simulation or degraded. Prefer one shared pure mapping used by runtime and tests. Run presentation should expose evidence kind and reason at the existing run-scoped surface without a second dialog.

- **Learning and notifications:** Success-only Learning and success notification semantics remain gated on verified success only (already partially shipped; extend tests so engine terminal matrix proves it).

- **Concurrency policy:** Do not change default single-run mode, max concurrent range, or ADR-0003 FIFO single intervention UI.

- **Prior art to extend, not replace:** scenario E2E fake run controller, production-module pure imports, capability／source smoke wiring.

## Testing Decisions

- Good tests observe external outcomes: number of Loop dispatches, Archive entries, `onSettled` counts, capacity free／busy, MCP transport call counts, terminal status, Archive status, evidence kind, Learning side effects, and user-visible presentation fields. They do not assert private Map layout, timer implementations, or incidental log order.

- **Seam 1 — Task run lifecycle:** Extend the scenario E2E／task-run contract matrix for (a) concurrent duplicate `runId` admit under opt-in concurrency, (b) post-finalize re-admit, (c) double finalize producing single Archive／settlement／drain, (d) interactive + automation sources. Add production-module coverage for pure admit／finalize decision helpers if extracted.

- **Seam 2 — MCP side-effect:** Production-module tests for metadata override + name fallback; fixture proving transport not invoked before approval (and not invoked on deny／unattended timeout). Source／capability smoke may only supplement, not replace, the transport observation.

- **Seam 3 — Execution evidence honesty:** Production-module tests that Archive mapping never upgrades simulation／degraded to success; engine-facing or harness fixtures for LLM transport failure, malformed DoD verdict, and explicit simulation asserting non-success terminal + no success Learning; presentation／view-model level assertion that evidence kind is visible on the run-scoped surface.

- Concurrent question isolation (two Loop runs, resolve／timeout independence) should appear as a scenario-level regression under seam 1 or 3 as appropriate, not only store-unit coverage.

- Prior art: existing trust-01 scenario cases, `executionEvidence`／`mcpSideEffect`／`taskRunAdmission` production-module tests, smoke-caps source contracts, permission／question FIFO store tests.

- Verification gate for the implementation: build typecheck, full smoke suite, lint on touched areas, and diff whitespace check per repo habit.

## Out of Scope

- Replacing or redesigning ADR-0003 concurrency defaults, queue／steer policy, or multi-dialog HITL UIs.
- New MCP providers, OAuth, plugin install, or model selection features.
- Reopening workspace list create-on-list (already fixed) except as a regression guard if touched incidentally.
- Full IDE／SubDesign layout work, content publishing, or OpenCode Windows CI fixtures.
- Background delegate restart persistence and schedule optimistic-save recovery (still separate P1 reliability).
- Expanding the throwaway task-run trust prototype into production state (prototype remains research-only).
- Accessibility-only HITL／terminal polish beyond what is required to show evidence kind and run identity.

## Further Notes

- This spec is a **follow-on** to `.scratch/execution-trust-and-safety/`. That feature’s issues 01–04 established the first vertical slices; this document captures code-review residual risk so an AFK agent can close the trust boundary without re-litigating the original problem statement.
- Domain language follows `CONTEXT.md`: **Chat turn** vs **Task run** vs **Loop run**; **Definition of Done** is only claimable with verified execution evidence; external CLI success remains non-DoD.
- Recommended ticket decomposition after this PRD: one issue per seam (lifecycle, MCP transport／metadata, evidence presentation／archive), numbered `01`–`03` under this feature directory, each with checklist items drawn from the Testing Decisions.
- Seams confirmed with the product owner before writing this document: the three-seam set (lifecycle, MCP side-effect, evidence honesty).
