# Hermes 對齊收尾：刪 runDelegatedTask + executor 去 switch

Status: resolved

## Problem Statement

在 `hermes-aligned-runtime` 之後，產品路徑已大致對齊 Hermes 的「registry dispatch + runTask 委派」，但仍留兩處 **非 Hermes** 形狀：

1. **`runDelegatedTask` 仍 export**  
   已是 `@deprecated` 薄包裝到 `runTask`，但公開符號仍在。Hermes **沒有**對等 export——委派只有工具 `delegate_task` 的 handler 內部 `AIAgent.run_conversation`。compat 層會讓新程式繼續 import 錯誤入口。

2. **`executeTool` 仍是 ~47 case 的 god switch（`executor.ts` ~1269 行）**  
   `tools/registered/*.ts` 已 self-register，但 handler 多半 **再呼叫** `executeTool`，等於 registry 是門面、真正 I/O 權威仍在中央 switch。  
   Hermes 是 **`registry.dispatch → entry.handler`**，handler 實作在 tool 模組（或 toolset 檔），**沒有**全工具中央 switch。

若不收斂：雙權威（registry vs executor）會繼續漂移；委派 API 心智仍三層（tool / runTask / runDelegatedTask）。

## Solution

依 Hermes 與既定選項 **C** 做兩段：

| 段 | 內容 |
|----|------|
| **A** | **物理刪除** `runDelegatedTask` export（連 compat 都不要）。全庫零引用；委派只經 `delegate_task` 工具 → `runTask`，或測試直接 `runTask`。 |
| **B** | 把 `executeTool` 各 case **搬進**對應 `registered/<tool>.ts` handler（必要時抽 **共用 primitive** 到 `toolIoHelpers` 類模組，不是第二個 switch）。搬完後 **刪除** `executeTool` 大 switch；若需保留檔名，只剩 shared helpers（project root、IPC 格式化）。Dispatch 唯一入口：`dispatchRegistered` / registry。 |

**對照 Hermes（決策依據）：**

- 委派：無 `runDelegatedTask` 符號；只有 tool handler + 核心 loop 建構。  
- 工具：`register(name, schema, handler)`；`dispatch` 查表呼叫 handler；錯誤包成字串。  
- 共用邏輯：library 模組，不是中央 execute_all。

## User Stories

1. As a 開發者, I want no `runDelegatedTask` export, so that the only nested admission API is `runTask` (plus the `delegate_task` tool).
2. As a 開發者 reading Hermes, I want tool I/O to live next to register(), so that I do not open a 1200-line switch to change one tool.
3. As a maintainer, I want `dispatchRegistered` to be the only builtin dispatch path, so that registry and runtime cannot diverge.
4. As a reviewer, I want smoke to fail if executor regains a tool switch or if runDelegatedTask is re-exported.
5. As a 開發者 adding a tool, I want to edit one registered module only, so that adding I/O does not touch a central switch.
6. As a test author, I want to call runTask or registry handlers directly, so that I do not depend on a deprecated delegate helper.
7. As a product owner, I want bit-for-bit tool behavior during the move, so that this is structure-only unless a documented bugfix is intentional.

## Implementation Decisions

### A — Delete runDelegatedTask

- Remove `export async function runDelegatedTask` from `hermes/delegate.ts` entirely.
- Update any remaining imports (tests, docs, comments).
- Keep `runDelegateBatch` only if it already uses `runTask` (it should); otherwise rewrite or delete.
- Keep `DelegationBudget` if still used elsewhere; otherwise leave as pure budget helper.
- Smoke / drift-guard: `rg` or source assert no `runDelegatedTask` symbol in `app/src`.

### B — Split executeTool into registered handlers

- **Batch by toolset** (Hermes-like grouping; still one register per tool name is fine):
  1. workspace_* + bash + table_parse + datetime  
  2. memory_* + skill_*  
  3. web_search + http_fetch + mcp_* + monitor + message_send + json_extract_lite + update_plan  
  4. codegraph_*  
  5. design_* + ask_user  
  6. delegate_task / delegate_status (handlers call runTask / status APIs, not a nested execute switch)
- For each batch: move case body into `registered/<name>.ts` handler; remove case from `executeTool`; keep smoke green.
- Extract **shared primitives** only when 2+ tools need them (e.g. project root resolve, IPC feature detect) into a thin helper module — not a new mega-switch.
- End state: no `switch (tool)` over ToolName in executor; `executeTool` deleted or reduced to re-export of `dispatchRegistered` **only if** a transitional alias is required for one PR — prefer delete and update all call sites to `dispatchRegistered`.
- Registered modules must not call `executeTool` (anti-recursion / dual path). Smoke: no `executeTool` import from `registered/*`.

### Sequencing

1. Ticket: delete runDelegatedTask (unblocks mental model; small).  
2. Tickets: migrate executor batches (blocked by nothing except each other in order, or parallel if careful).  
3. Ticket: final contract — executor empty / deleted; guards.

### Out of scope

- Rewriting Hermes AIAgent child construction (we keep runTask).  
- Changing Approval Decision or invokeGatedTool pipeline.  
- Reopening tool schema / capability ownership model.  
- Full one-file-per-toolset merge of registered modules (optional later style).

## Testing Decisions

- True-import / behavior: existing tool smokes must stay green after each batch.
- Drift-guards:
  - no `runDelegatedTask` in `app/src`
  - no `executeTool` imports under `registered/`
  - no large `case '…'` tool switch remaining in executor (or file gone)
  - `registryHandlersComplete()` still true
- Prefer one smoke file for this effort: `smoke-registry-executor-cleanup.mts` or extend `smoke-tool-registry.mts`.

## Out of Scope

- Product behavior changes to tools  
- Parallel tool policy (already P5)  
- ContextEngine algorithm rewrite  

## Further Notes

- Parent: `.scratch/hermes-aligned-runtime/`  
- Hermes refs: `tools/registry.py` dispatch; `tools/file_tools.py` multi-register; `tools/delegate_tool.py` AIAgent in handler  
- Domain: Task run, Tool Invocation, registry dispatch, agent-level intercept

## Implementation notes (2026-07-20)

Tickets 01–05 done: no `runDelegatedTask`; all 47 tools in `registered/*`; `executor.ts` is helpers re-export only; `toolIoHelpers` holds rewind / web fallbacks / git bash rewrite; smoke-registry-executor-cleanup in `npm run smoke`.
