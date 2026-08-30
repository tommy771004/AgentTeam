# Adaptive Agent Run Status Surface

Status: resolved

## Problem Statement

Agent 執行中的側欄目前把三種不同層級的資訊混在一起：短暫的 runtime phase、Host-owned Working State，以及送進模型的 instructions/context。結果是「目前狀態」可能顯示完整 objective，而「工作狀態」又把同一段文字連同專案規則、對話歷史、絕對路徑與 `Host 已驗證 rev 1` 等內部資訊展開。這些內容對除錯有價值，卻不能回答使用者當下最基本的兩個問題：Agent 現在正在做什麼，以及這次任務已完成到哪裡。

固定顯示「工作狀態」也會造成不誠實的能力暗示。Builtin Pi 可以投影 Checker-backed Working State；External CLI、簡單 turn-based 任務或尚未形成可靠 goals 的 run 並沒有相同保證。把所有 runner 都壓成 `0/1 已驗證`、百分比或目標清單，會把不確定的流程包裝成可量測進度，並讓底層 capability metadata 變成主要 UI。

這個 surface 需要成為一個依 run 狀態與證據能力自適應的使用者投影：第一區只呈現可信且短暫的執行狀態；第二區只在有實質內容時呈現任務進度、最近活動、需要使用者處理或執行摘要。完整 Turn Record、instruction provenance、runner capabilities、revision 與 evidence identities 保留在既有的稽核／診斷 surface，不應進入預設狀態摘要。

## Solution

將第一區明確命名為「執行狀態」，只由 trusted Host/runtime lifecycle 事件投影一個短句 phase，例如準備、分析、搜尋、讀取專案、修改檔案、執行工具、驗證、整理回覆、等待核准、等待輸入、等待登入、完成、取消或失敗。區塊可顯示目前動作、經過時間與最後更新時間；只有 Host 提供可確定的總量時才顯示百分比。模型自由文字、instructions、context bodies、絕對路徑與 capability revision 不得成為狀態文案來源。

第二區改為自適應內容，而非永遠顯示「工作狀態」。Agent 透過 Host `update_plan`／外部 runner plan event 回傳 structured run tasks 時顯示「任務進度」，以 `docs/ui/Task Rows.md` 的互動語彙呈現 pending、active、done 與 failed；沒有 structured tasks 時顯示「最近活動」，列出最近三至五筆可信工具／runtime 事件。Working State objective、admitted request、reference history 與 constraints 永遠不能退化成 task milestone。等待核准、登入或輸入時顯示「需要你處理」與唯一清楚動作；terminal run 顯示「執行摘要」，整理結果、變更、驗證與失敗原因。簡單單步任務沒有第二層資訊時，整區隱藏。

建立一個純 UI Projection contract，依 frozen runner capability、run lifecycle、Host-carried structured plan 與 bounded activity/settlement events 選擇 variant。它不建立第二份 task state，也不從 transcript、Working State objective 或 instruction bodies 推測 tasks。任務清單的勾選表示 Agent 回報的 plan 狀態；Builtin 是否真正完成仍以 Checker-backed Working State 為準，並保留在 owning diagnostics。External CLI 只陳述觀察到的 plan/activity 與 process outcome，不宣稱 Host 驗證。

把 `Host 已驗證`、revision、runner kind、instruction source/hashes、constraints 與 evidence identities 收進收合的「執行資訊」或既有軌跡／context surface。預設狀態 UI 至多顯示 bounded 的來源數量或來源名稱，不顯示 instruction bodies。所有 live status 更新使用安靜的 status announcement；頻繁 activity 不逐筆打擾輔助科技。

## User Stories

1. As a user watching an Agent run, I want to see one short description of what it is doing now, so that I can understand the live state at a glance.
2. As a user, I want execution phase and task progress shown separately, so that a temporary action is not confused with durable completion.
3. As a user, I want the current phase derived from trusted runtime events, so that model prose cannot impersonate system status.
4. As a user, I want project instructions and reference chat history excluded from the status surface, so that internal context does not overwhelm the task.
5. As a user, I want absolute paths and full instruction bodies hidden from the default run panel, so that implementation details and potentially sensitive context are not exposed unnecessarily.
6. As a user running a Goal-based builtin task, I want stable milestones with pending, current, done, and blocked states, so that I can assess real progress.
7. As a user, I want completed milestones marked only when Host evidence supports them, so that a check mark has consistent meaning.
8. As a user, I want blockers shown beside the affected milestone, so that I know why progress stopped.
9. As a user running an External CLI task, I want recent observed activity instead of invented verified goals, so that reduced runner guarantees are represented honestly.
10. As a user running a simple one-turn task, I want the secondary section hidden when it adds no useful information, so that the panel stays concise.
11. As a user waiting on approval, I want the panel to say what needs my approval, so that I can unblock the run quickly.
12. As a user waiting on authentication, I want the panel to identify the required sign-in action, so that low-level runner state is translated into a useful next step.
13. As a user waiting on input, I want one clear requested action, so that I do not need to inspect logs to continue.
14. As a user reviewing a completed run, I want a concise execution summary of results, changes, and checks, so that completion is more useful than a terminal status label.
15. As a user reviewing a failed run, I want the summary to state the bounded failure reason and next recovery action, so that raw logs are optional.
16. As a user, I want progress percentages only for determinate work, so that an arbitrary number does not imply false precision.
17. As a screen-reader user, I want important lifecycle changes announced without every activity event being read aloud, so that live updates remain usable.
18. As a maintainer, I want one deterministic projection to select the secondary variant, so that live, replay, reload, and archive do not disagree.
19. As a maintainer, I want the projection to consume frozen runner capabilities, so that an old External CLI run cannot inherit newer builtin guarantees.
20. As a maintainer, I want Working State to remain Host-owned, so that renderer copy changes cannot create or mutate completion truth.
21. As a maintainer, I want instruction provenance separated from user-facing status, so that auditability is preserved without leaking full context into the primary surface.
22. As a maintainer, I want bounded recent activity derived from the existing Turn Record or trusted activity transport, so that no second execution timeline is introduced.
23. As a maintainer, I want malformed or missing events to degrade to an honest generic phase, so that the UI does not manufacture specifics.
24. As a maintainer, I want one high-level rendered projection test to cover the state matrix, so that the specification is verified at the surface users actually see.
25. As a maintainer, I want hostile instruction fixtures to be absent from rendered status text, so that future context assembly changes cannot reintroduce the leak.

## Implementation Decisions

- **Two-layer information model.** The primary layer is volatile Execution Status; the optional secondary layer is durable Task Progress, bounded Recent Activity, Needs Your Attention, or Execution Summary.
- **Projection authority.** The renderer performs a deterministic, read-only UI Projection from Host-owned lifecycle, Host-carried structured Agent plan, frozen runner capability, activity, approval, authentication and settlement facts. It does not infer tasks from transcript text, admitted objective or Working State prose.
- **Execution Status vocabulary.** Use a bounded product vocabulary for preparing, analyzing, searching, reading the project, editing, running a tool, validating, composing, waiting for approval, waiting for input, waiting for authentication, completed, cancelled and failed. Unknown live states degrade to a neutral running label.
- **No free-text status source.** Objective, assistant messages, instruction snapshot bodies, constraints, logs and raw tool output cannot populate the primary status label.
- **Structured-plan variant.** Show Task Progress only from Agent-returned structured run tasks carried by the Host/runner plan event. The plan is presentation state, not Checker evidence; Working State keeps owning verified completion but does not supply milestone copy.
- **Task Row lifecycle.** Live tasks use capsule rows; archived summaries use list rows. Stable task id, bounded short meta and bounded expandable child details may flow from the Agent-authored structured plan through live, reload fallback and terminal archive. Animations never advance status, and no detail may be synthesized from prompt, transcript or raw tool output.
- **Activity variant.** When reliable goals are absent, show the most recent three to five trusted, user-comprehensible actions. Coalesce repeated low-value events and exclude reasoning text, prompts, instructions, tokens and raw output.
- **Attention variant precedence.** Approval, authentication and user-input requirements take precedence over progress/activity because the run cannot proceed without the user. Show one explicit action and preserve detailed policy in the existing approval surface.
- **Terminal variant precedence.** Completed, cancelled and failed runs show Execution Summary. The summary contains bounded outcomes and verification facts; it does not reinterpret External CLI process success as Checker-backed completion.
- **Conditional visibility.** The secondary section is omitted when it has no meaningful content. Empty goals, fabricated `0/1` progress and placeholder copy are not meaningful content.
- **Determinate progress only.** Percentage and progressbar semantics require a known, stable denominator. Dynamic agent work remains indeterminate and uses elapsed time or activity instead.
- **Internal metadata placement.** Host verification, revision, runner guarantee, instruction provenance, evidence identities and constraints move to a collapsed Execution Information or existing trajectory/context surface.
- **Instruction privacy.** The default surface never displays instruction bodies, reference chat history, absolute source paths or raw context composition. A diagnostic surface may expose bounded provenance according to its existing authority and redaction rules.
- **Replay consistency.** Live, renderer reload, archive and replay select the same variant from the same record facts. Late or stale renderer events cannot revive older state.
- **Accessibility.** The primary lifecycle sentence is a polite status message. Activity lists do not form a noisy live region; progressbar semantics are used only for determinate progress; keyboard and focus behavior reuse existing accessible disclosure controls.
- **Visual continuity.** Reuse the product's existing compact rail typography, spacing, status colors and disclosure language. The change is an information-architecture correction, not a parallel visual system.
- **ADR alignment.** Pi Host remains canonical, the Turn Record remains the auditable timeline, External CLI capability remains reduced unless proven otherwise, and instruction snapshots remain reconstructable without becoming primary status copy.

## Testing Decisions

- **Primary seam: rendered live run panel through public Host/runner projections.** One gated high-level smoke renders the actual run panel and drives it with public lifecycle, Working State, approval/auth/input, activity and settlement fixtures. It asserts visible headings, summaries, ordering, disclosure defaults, accessibility semantics and forbidden text. It must not reproduce the projection rules in a test-only reducer.
- **State matrix.** The primary smoke covers Goal-based builtin progress, builtin without goals, External CLI activity, simple one-turn hiding, approval, authentication, user input, completed, cancelled and failed variants.
- **Trust boundary fixture.** Feed an instruction snapshot and objective containing reference chat history, project-rule bodies, absolute paths and internal revision text. Assert none appear in Execution Status or the open secondary section while bounded diagnostic provenance remains reachable only through its owning disclosure.
- **Progress honesty.** Assert determinate percentages only when a stable denominator exists. Dynamic builtin and External CLI work remain indeterminate, and External CLI process exit cannot render Host-verified completion language.
- **Replay equivalence.** Render the same frozen record as live projection, after renderer reload and as archive/replay; assert the same secondary variant, milestone ordering and terminal summary.
- **Accessibility.** Assert one polite live status region, correct disclosure semantics, no activity-feed live-region spam, and progressbar attributes only for determinate values.
- **Good-test rule.** Assertions target user-visible language and public evidence/capability boundaries. Source-text regex may remain as a narrow drift guard, but it cannot be the primary acceptance evidence.
- **Gate requirement.** The rendered projection smoke and any supporting drift guard must run in the actual repository smoke chain before the issue can be marked resolved.

## Out of Scope

- Changing how project, global or learned instructions are discovered, assembled, stored or delivered to models.
- Editing the Host-owned Working State schema, Checker completion predicates or evidence authority.
- Making External CLI capability-equivalent to builtin Pi.
- Replacing the Turn Record, activity transport, approval system, authentication flow or task-run coordinator.
- Adding a new renderer-owned task ledger, transcript parser or guessed plan generator.
- Displaying chain-of-thought, raw reasoning, full prompts, raw tool output or full instruction bodies in the status panel.
- Redesigning the complete conversation feed, Archive, trajectory viewer, context usage panel or release qualification workflow.
- Introducing arbitrary numeric progress for open-ended agent work.
- Creating a new visual theme or broad navigation redesign.

## Further Notes

- Product research informing this contract consistently separates current runtime status from plans, activity logs and outcome summaries. It also treats input/authentication requirements as explicit states rather than ordinary progress.
- “Working State” remains valid architecture vocabulary, but “任務進度” is the clearer default user-facing label when the capability truly exists.
- The key privacy and clarity invariant is not merely redaction: instruction content is the wrong semantic source for execution status even when it contains no secret.
- This spec extends the completed Verified Working Memory UI Projection effort. It changes presentation and variant selection while preserving its Host authority, monotonic projection and bounded evidence contracts.
