# 執行可信度與安全邊界

Status: 可交給代理

## Problem Statement

使用者需要相信每一個 Chat turn 觸發的 Task run 都有唯一、可追溯且正確的結果。現況在 opt-in 並行 Loop run、LLM 降級與 generic MCP 工具之間仍有三種高風險落差：同一 run 可能重複完成或被錯誤操作、外部寫入可能未依實際 MCP 工具判定核准需求、以及 LLM 失敗後的模擬產出可能被呈現為真實成功。

這些落差會讓使用者停止錯誤的工作、回答錯誤的人工提問、誤信 Definition of Done 已達成，或在未預期的情況下改變外部系統與專案工作區。

## Solution

建立一份一致的 Task run 信任契約：每個 `runId` 只允許一個 owner 執行與完成；每個人工提問、執行畫面與停止動作皆明確綁定同一個 Loop run；MCP 的核准決策依實際目標工具的副作用分類；只讀 workspace 操作不產生寫入；LLM 或 DoD 驗證失敗時，產品明確顯示降級或失敗，而不宣稱已成功完成。

現有 `runTask` scenario E2E 是主要外部行為 seam。權限與結果語義的測試也應透過同一份 task-run contract matrix 驗證，而非替內部實作新增平行測試入口。

## User Stories

1. As a 使用者, I want one Task run to execute at most once, so that retry、重複事件或重複 callback 不會重複改變結果。
2. As a 使用者, I want duplicate `runId` submissions to receive a clear deterministic outcome, so that I know no second Loop run was started.
3. As a 使用者, I want every Loop run to retain its own identity, so that I can distinguish simultaneous work without guessing.
4. As a 使用者, I want the execution view to show the same run that its controls operate on, so that stopping a run never affects another visible task.
5. As a 使用者, I want logs, progress, intervention, continuation and cancellation to share one selected run identity, so that the execution story is internally consistent.
6. As a 使用者, I want a question raised by one concurrent Loop run to remain associated with that run, so that my answer cannot unblock a different task.
7. As a 使用者, I want concurrent questions to use one understandable FIFO decision surface, so that I am not overwhelmed by competing dialogs.
8. As a 使用者, I want an unanswered question to time out only for its originating Loop run, so that other work remains unaffected.
9. As a 使用者, I want a generic MCP call to be classified by the actual server tool it invokes, so that dangerous operations cannot hide behind a generic wrapper.
10. As a 使用者, I want default approval mode to ask before MCP writes, so that I can review external changes before they occur.
11. As a 使用者, I want unattended Task runs to deny or time out MCP writes without approval, so that scheduled and delegated work cannot silently mutate external systems.
12. As a 使用者, I want explicit full-access behaviour to remain visible and deliberate, so that a deliberate setting change is not confused with an approval bypass.
13. As a Plan-mode user, I want workspace listing to remain read-only, so that inspecting a missing path never creates a directory.
14. As a Build-mode user, I want a missing workspace path reported clearly, so that I can choose a write operation intentionally rather than receiving a hidden filesystem change.
15. As a 使用者, I want an LLM transport or model failure to be reported as a failed or degraded Loop run, so that I do not mistake generated fallback prose for completed work.
16. As a 使用者, I want explicit offline simulation to be visibly marked as simulation, so that it remains useful for exploration without claiming real evidence.
17. As a 使用者, I want Definition of Done to require trustworthy execution evidence, so that random confidence or fallback text cannot certify a goal.
18. As a 使用者, I want a degraded result excluded from success-only Learning, notifications and Archive semantics, so that later product behaviour is not trained on false success.
19. As a 使用者, I want the Archive to preserve the reason for failure or degradation, so that I can diagnose and safely retry a Task run.
20. As an operator, I want every terminal transition to be recorded once, so that Archive, queue drain and automation settlement remain auditable.
21. As an automation owner, I want a duplicate or denied Task run to settle cleanly, so that a schedule does not remain permanently marked as running.
22. As a developer, I want the contract to hold for builtin, external CLI and delegate ingress, so that all product entry points keep the same lifecycle guarantees.
23. As a developer, I want the concurrency contract to preserve ADR-0003's opt-in cap and FIFO interaction model, so that this fix does not silently change the concurrency rollout.
24. As a reviewer, I want test fixtures to demonstrate no external MCP transport occurs before required approval, so that the safety claim is observable.
25. As a reviewer, I want test fixtures to demonstrate that a simulated or degraded result cannot be presented as successful, so that the product trust boundary is regression-protected.

## Implementation Decisions

- The Task run coordinator remains the sole admission and finalization authority. It will own a terminal-state guard keyed by `runId`; a duplicate admission must not dispatch work, write a second user bubble, create a second Archive record, invoke `onSettled` again, release capacity twice, or trigger an additional queue drain.
- Duplicate submission behaviour is deterministic: an already active or finalized `runId` returns a non-success duplicate outcome carrying the existing run identity and reason, without starting another Loop run.
- Run presentation becomes explicitly run-scoped. The execution surface receives or resolves one selected `runId` and uses it consistently for state, progress, logs, cancellation, continuation and manual intervention.
- Question requests gain originating `runId` and `threadId` identity. They use the existing single FIFO dialog pattern from ADR-0003, with request-specific resolution and timeout; this work does not introduce per-thread parallel dialogs.
- Generic MCP invocation is classified using the invoked server tool name and, when available, declared server metadata. Unknown or write-like target tools are treated conservatively. The existing policy order remains deny first, then required approval, then the configured approval mode.
- Default auto mode and unattended runs must not silently approve MCP writes. Explicit full-access mode remains an intentional user-controlled policy and must be clearly logged; unattended work continues to downgrade from full access according to the existing safety rule.
- Workspace listing never creates a missing path. Missing paths return a typed not-found outcome; creating directories remains an explicit write operation subject to the existing authorization model.
- Execution evidence is classified separately from user-facing prose. Explicit simulation, degraded execution after an LLM failure, and verified successful execution are distinguishable states in run presentation and Archive records.
- A configured LLM failure cannot be converted into a successful step or successful Definition of Done through synthetic output or randomized confidence. A goal requiring semantic validation remains unmet when trustworthy validation evidence is unavailable.
- Success-only behaviours, including success learning, success notifications and success Archive language, execute only for verified successful Loop runs. Degraded and simulated results keep their diagnostic output and a retry path without asserting Definition of Done.
- The contract applies uniformly to composer, slash, retry, schedule, webhook, Telegram and delegate sources through the canonical Task run lifecycle.

## Testing Decisions

- Good tests observe lifecycle outcomes: executed work, user-visible run identity, approval before transport, filesystem state, terminal status, Archive effects and settlement callbacks. They must not assert private map layout, implementation-specific timers or incidental log ordering.
- Extend the existing task-run scenario E2E harness as the highest seam. It already models busy policy, concurrent capacity, queue drain, source kinds and run-scoped state, making it the canonical place for duplicate admission and cross-run interaction behaviour.
- Add production-module tests for deterministic admission/finalization and question request identity where a real module import is needed to prevent source-only drift.
- Add capability smoke coverage for generic MCP target-tool classification, approval-before-transport behaviour, and workspace list no-write behaviour.
- Add engine-facing fixtures for configured LLM failure, explicit simulation and DoD evaluator failure. Assert the external terminal status and downstream Learning/Archive behaviour rather than private confidence calculations.
- Cover interactive default approval, unattended approval timeout or denial, explicit full-access logging, and deny precedence separately so that security behaviour remains intentional across modes.
- Cover two concurrent Loop runs that each request a question, then resolve and time out them independently while keeping the FIFO presentation.
- Cover duplicate `runId` submission from at least one interactive and one automation source; assert a single dispatch, single terminal record and single settlement.
- Existing scenario E2E, capability smoke and production-module smoke suites are the prior art; new cases should extend their contract tables instead of adding a separate test runner.

## Out of Scope

- Formatter preview/write UI and real OpenCode Windows/macOS CI fixtures.
- Background delegate restart persistence and schedule optimistic-save recovery; these are follow-on P1 reliability work.
- A redesign into multiple simultaneous HITL dialogs or per-thread inline approval panels.
- Terminal tab accessibility, dialog focus trapping and countdown presentation improvements, except where run identity is required to preserve correct question routing.
- New MCP providers, provider discovery, OpenCode share, plugin installation or model-selection features.
- Changing the default concurrency setting, maximum concurrency range, queue/steer policy, or ADR-0003's capped opt-in rollout.

## Further Notes

- This spec uses the product vocabulary from `CONTEXT.md`: a Chat turn may initiate a Task run, and the Task run owns lifecycle admission and terminal settlement while a Loop run executes the selected pattern.
- This spec reinforces ADR-0003 rather than reopening it. The required product behaviour remains default single-run operation with opt-in capped concurrency and a single FIFO human-intervention surface.
- Follow-on specs should separately address P1 restart persistence, automation save failure recovery, and P2 HITL/terminal accessibility after this trust boundary is closed.
