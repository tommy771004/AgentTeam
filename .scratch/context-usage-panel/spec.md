# 上下文／用量面板（Context Usage Panel）

> 狀態：`可交給代理`

## Problem Statement

任務對話執行時，使用者看不到這個 run 花了多少 token、多少錢、上下文還剩多少。唯一可見的是 `/cost` 吐出的一個總量 scalar 和執行摘要角落的一行 `tokens N · Nms`——沒有輸入/輸出/快取的分解、沒有成本、沒有對 context window 的比率、沒有按角色（助理/工具/使用者）的細分。快取與成本資料在 Pi Core Host 的每一步其實都拿得到，卻在記錄時被丟棄，事後無人能回答「這個 run 為什麼燒了這麼多 token」。

## Solution

在執行摘要（InlineRunPanel）新增一個「上下文」收合區塊：總量對 context window 的比率條、輸入/輸出/快取/成本、按角色的細分條、訊息/工具/步驟計數。資料全部從 Turn Record 經一個新的純投影 `projectContextUsage` 推導，live 與 replay 同源；記錄層把 Host 本來就有卻丟掉的快取與成本欄位補進 `step-end` 的 usage（向後相容的 optional 欄位）。`/cost` 升級為輸出同一投影的完整分解；執行程序 header 加上 `73.2k tok (7%)` microcopy；完成後的 run 摘要氣泡帶 token/成本。

## User Stories

1. As a task conversation user, I want to see a run's total token usage against the model's context window as a ratio bar, so that I know how close the conversation is to compaction before it happens.
2. As a task conversation user, I want input/output token counts shown separately, so that I can tell whether cost is driven by long context or long answers.
3. As a task conversation user, I want cached-token counts (read/write) shown, so that I can verify prompt caching is actually saving me tokens.
4. As a cost-conscious user, I want each run's estimated cost in US$, so that I can judge whether a workflow is economical before automating it.
5. As a cost-conscious user, I want the cost computed only when pricing data exists for the model, so that I am never shown an invented number.
6. As a task conversation user, I want a context breakdown by role (assistant / tool / user / reasoning), so that I can see which part of the conversation dominates my context.
7. As a task conversation user, I want message, tool-call, and step counts in the same panel, so that I can relate token usage to actual work done.
8. As a user watching a live run, I want the usage numbers to update as steps settle, so that the panel reflects reality without refreshing.
9. As a user watching a live run, I want the currently running step to show as running rather than a guessed token count, so that the panel never lies about unmeasured work.
10. As a user reviewing a finished run, I want the same usage numbers available on replay from the persisted record, so that what I watched and what I read back agree.
11. As a user reviewing a finished run, I want the run summary bubble to carry tokens and cost, so that I can compare past runs without reopening each one.
12. As a user scanning the conversation, I want a compact `73.2k tok (7%)` microcopy in the process feed header, so that I get usage at a glance without opening any panel.
13. As a power user, I want `/cost` to output the full breakdown (input/output/cache/cost/ratio), so that I can check usage from the composer without touching the mouse.
14. As a user with an external CLI runner, I want the panel to fall back honestly to what the CLI reports (scalar tokens only), so that the panel degrades instead of fabricating a breakdown.
15. As a user who switched models mid-session, I want the ratio computed from the current model's context window, so that the percentage reflects the model actually running.
16. As a user on a model without a known context window, I want the ratio omitted rather than computed from a wrong default, so that I am not misled.
17. As a developer debugging token blowups, I want per-step usage in the trajectory footer extended with cache and cost, so that I can locate which step was expensive.
18. As a replay auditor, I want usage fields to be optional additions to the record format, so that older archived records still load and project unchanged.
19. As a maintainer, I want all usage figures derived by one pure projection from the Turn Record, so that no second source of truth can drift from the Host's account.
20. As a maintainer, I want the panel to follow the existing design tokens and idioms, so that the feature reads as part of the app rather than a bolt-on.

## Implementation Decisions

- **單一新接縫**：新增純投影模組 `projectContextUsage(record, { contextWindow? })`，與 conversationProjection / runOperationsProjection 同族同純度合約（no I/O、no store、no clock）。輸出：`{ steps, messages: {user, assistant}, toolCalls, tokens: {input, output, cachedRead, cachedWrite, total}, costUsd?, breakdown: {assistant, tool, user, reasoning}, contextWindow?, ratio?, lastActivityAt }`。
- **記錄格式擴充（向後相容）**：`step-end` 的 `timing.usage` 增加 optional `cachedRead` / `cachedWrite` / `costUsd`。舊記錄缺欄位照樣 parse 與投影。
- **Host 端補抓**：Pi Core Runtime 在組 step timing 時，從 Pi `Usage` 的 `cacheRead` / `cacheWrite` / `cost.total` 縮減進 usage——這些值已存在，現行 reducer 丟棄它們。成本由 Pi model catalog 的定價計得，app 不自建定價表。
- **直接 OpenAI-compat 路徑**：transport 層補 parse `prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`；成本僅在 `ModelProfile` 帶 optional `pricing`（input/output/cacheRead/cacheWrite 單價，Settings 可編輯）時計得。
- **contextWindow 解析**：沿用現行鏈（modelProfiles → default fallback）；比率只在 contextWindow 已知時計算。Pi 路徑優先採用 Host 已發布的 context 值。
- **細分估算**：按 entry 種類的字元量估算比例（與 opencode 同級）；量測值（step usage）永遠優先，估算只用於比例呈現，面板標示其為估算。
- **消費端**：InlineRunPanel 新增「上下文」PanelSection（新元件 ContextUsagePanel，讀 `presentations[runId].recordEntries` + `recordTotal`）；RunProcessFeed header microcopy（沿用 `onOpenPanel` 進入點）；`/cost` 改輸出投影結果；ThreadRunSummary 增加 tokens / costUsd 欄位供完成後氣泡顯示；TrajectoryPanel footer 補快取與成本。
- **UI 樣式**：全用既有 design token——`bg-inset` 井、10px tracking 區塊標題、mono + `tabular-nums` 數字、Material Symbols、單色進度條與 accent 色階細分條；不引入新漸層、glow 或新字體。
- **外部 CLI runner**：無 Turn Record 時面板退回現行 scalar（`tokensUsed`），不顯示分解，如實降級。

## Testing Decisions

- 只測外部行為：fixture Turn Record 餵進 `projectContextUsage`，斷言輸出的數字與欄位，不測內部實作。
- 測試接縫僅一個：投影模組本身。比照 conversation-projection smoke 的 fixture 模式（no Electron、no store），新 smoke 掛進 `smoke` 鏈。
- 既有 smoke 延伸：turnRecord parse smoke 補 optional usage 欄位的讀取斷言；conversation / run-operations / live-timeline / trajectory-paging 四支 smoke 確認新欄位不破壞既有投影。
- 記錄格式向後相容以「缺欄位的舊記錄投影輸出完全不變」斷言。

## Out of Scope

- 每則訊息層級的 token 歸因（opencode 把 cost 記在 message 上；本效應維持 step 粒度）。
- 分頁式原始訊息瀏覽器（TrajectoryPanel 的掛載與虛擬化是 turn-record-fidelity 既有的刻意未完成項）。
- 跨 run / 全域的用量統計頁（Dashboard 既有 tokensUsed 顯示不動）。
- 自建模型定價資料庫——Pi 路徑用 catalog 定價，OpenAI-compat 路徑用使用者自填的 ModelProfile pricing，都不內建價目表。
- Compaction 後的「已釋放 token」呈現。

## Further Notes

- 動機對照：opencode 的 session 上下文面板（Session → Message → Part 三層、token/cost 記在訊息層、UI 純投影）。本專案的事實單位是 Turn Record entry，故 token/cost 落在 `step-end` 而非訊息層——這是 ADR-0039/0049 語意下的正確位置。
- 遵守 ADR-0048 語意：面板只呈現量測值；未量測即顯示 running 或省略，絕不推算填數。
- UI 文案維持 Traditional Chinese mixed with English 慣例。

## Tickets

| # | Ticket | Blocked by |
|---|--------|-----------|
| 01 | [usage 記錄擴充 + Host 補抓](issues/01-usage-record-capture.md) | — |
| 02 | [OpenAI-compat 路徑補抓 + ModelProfile pricing](issues/02-openai-compat-capture-pricing.md) | 01 |
| 03 | [contextProjection 純投影 + smoke](issues/03-context-projection.md) | 01 |
| 04 | [ContextUsagePanel + 執行摘要區塊](issues/04-context-usage-panel.md) | 03 |
| 05 | [RunProcessFeed header microcopy](issues/05-feed-header-microcopy.md) | 03, 04 |
| 06 | [/cost 升級](issues/06-cost-slash-upgrade.md) | 03 |
| 07 | [完成後呈現](issues/07-finished-run-presentation.md) | 01, 03 |
| 08 | [qualification](issues/08-qualification.md) | 01–07 |
