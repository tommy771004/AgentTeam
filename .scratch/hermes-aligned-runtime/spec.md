# Hermes-aligned runtime：tool 軸全包 + 分 phase

Status: resolved

## Problem Statement

SubAgents AI 的 agent runtime 已局部對齊 Hermes（Task run 單一 ingress、`invokeGatedTool` 在 heuristic、Approval Decision 純決策），但與 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) 的核心形狀仍有系統性落差：

1. **Tool dispatch 雙路徑**：function-calling 的 `executeOneToolCall` 仍是 god 分派；heuristic 才走 `invokeGatedTool`。MCP 與 builtin 收尾易再漂。
2. **無 Hermes 式 tool registry**：catalog／schema／handler 未形成 import-time register + discover；`toolDefinitions` 與 executor switch 仍是權威碎片。
3. **Context 分散**：governor／pruning／checkpoint／packet 無單一 ContextEngine interface，也未對齊 Hermes 的 compress 順序與演算法紀律。
4. **Loop 編排多故事**：`engine` + 公開 `StepExecutor` 三策略 vs Hermes 單一 `run_conversation` 心智。
5. **Nested leaf 雙 ingress**：`delegate_task` 可直打 loop，繞過 Task run admission。
6. **Tool calls 僅序列**：未實作 Hermes 多 tool_call 並行（interactive 除外、結果保序）。

若不按 Hermes 可抄的 **dispatch → register → context → 單一 loop → 統一 admission → 並行** 順序收斂，後續每加一能力都會在兩套路徑上複製。

## Solution

同一 effort、**嚴格 phase 串行**（可分 phase merge），完整交付下列能力（grilling 2026-07-20 鎖定）：

| Phase | 交付 |
|-------|------|
| **P0** | Agent-level intercept 表 + FC gated（**builtin + custom + MCP**）→ `invokeGatedTool`；對模型 tool 字串契約；halt rethrow 為唯一中止例外 |
| **P1** | Hermes **全套** tool registry：一工具一模組、`register()` import-time、AST／掃描 discover；definitions **由 registry 導出**；**big bang** 切換權威來源 |
| **P2** | ContextEngine interface + default adapter + **重做／Hermes 向壓縮演算法** |
| **P3** | 編排併回**單一 conversation／Loop run 核心**；撤公開 StepExecutor 三策略 seam（對齊 Hermes AIAgent） |
| **P4** | 所有 nested／leaf 委派 **強制** `runTask` |
| **P5** | 多 tool_call **並行**（interactive／HITL／agent-level 序列；結果保序） |

**不 litigate：** ADR-0003 concurrent **runs**（與 P5 並行 **tools** 不同層）。

## User Stories

1. As a 開發者, I want one gated-tool path for FC and heuristic, so that deny／truncate／afterTool cannot drift by step strategy.
2. As a 開發者, I want agent-level tools (plan, load_capability, tool_search, run_code, delegate_*) intercepted before gated dispatch, so that progressive disclosure and delegation never hit authorize-as-side-effect by accident.
3. As a 開發者, I want MCP tools on the same invokeGatedTool path as builtin/custom after P0, so that residual MCP buckets do not become permanent gods.
4. As a model consumer, I want every non-halt tool outcome to appear as a tool-role string, so that the Loop run never dies on a bare handler exception.
5. As a 開發者 adding a tool, I want a Hermes-style register + discover module, so that catalog/schema/handler live in one registration act.
6. As a maintainer, I want tool definitions derived from the registry, so that a second hand-maintained catalog cannot drift.
7. As a 開發者, I want a ContextEngine seam with Hermes-like compress discipline, so that preflight compress, protect-last-N, and memory flush order are testable in one place.
8. As a 開發者, I want one conversation/Loop run orchestration story, so that AI navigation does not require three StepExecutor factories plus engine.
9. As an operator of nested work, I want every leaf admission through Task run, so that unattended, hooks, and archive lineage match top-level runs.
10. As a user of multi-tool model turns, I want parallel tool execution with ordered results, so that latency drops without scrambling tool_call order or HITL safety.
11. As a reviewer, I want each phase independently green with true-import smoke, so that the full program can merge incrementally.
12. As a product owner, I want haltOnPayloadOverflow to still abort via SupervisorViolation when enabled on FC, so that settings meaning is not silently removed.

## Implementation Decisions

### Program

- **Effort:** `.scratch/hermes-aligned-runtime/`
- **Phasing:** serial P0→P5; each phase mergeable when its acceptance + smoke pass.
- **Upstream partial work:** heuristic `invokeGatedTool` + review-cleanup remain; P0 extends FC + MCP onto the same seam.

### P0 — Tool axis

- **#4 first:** same-file `isAgentLevelTool` / agent-level set + handler dispatch; bit-for-bit for intercept tools.
- **Intercept set:** plan enter/exit, `load_capability`, `tool_search`, `run_code`, `delegate_task` / `delegate_status` (and equivalent agent-state tools).
- **Then #1:** remaining gated path uses `invokeGatedTool` for **builtin + custom + MCP**.
- **No long-lived mcp residual bucket** after P0 completes.
- **#6:** deny / execute throw / soft fail → always `role: tool` string; **only** supervisor halt rethrows `SupervisorViolation`.
- **Halt:** extend `invokeGatedTool` with halt flag; heuristic stays truncate-only by not enabling halt.
- **Structure during migrate:** agent-level → gated → (temporary mcp only if mid-PR); end state two lanes only.

### P1 — Registry (Hermes full)

- Per-tool modules; `registry.register(...)` at import time; discover via AST/scan of tool modules.
- Public catalog/schema/keyword views **derived from registry**.
- **Big bang:** P1 ends with old `toolDefinitions` / executor switch **not** authoritative; deleted or pure re-exports from registry.
- Dispatch feeds `invokeGatedTool` (or is the execute side of it).

### P2 — ContextEngine

- ContextEngine interface (preflight compress, protect last N, optional memory flush-before-compress).
- Default adapter wraps/replaces current governor+pruning+checkpoint wiring.
- **Algorithm work in scope:** Hermes-oriented summarization / thresholds / pair integrity (tool call+result not split).

### P3 — Single loop orchestration

- Align with Hermes `run_conversation`: one Loop run / conversation orchestrator module owns pathing.
- **Remove public StepExecutor strategy factories** as the product seam (B then A: private then delete).
- Retain pure helpers only as private/loop-internal utilities.
- Tool/registry/context remain callable parts; they are not three competing orchestrators.

### P4 — Nested Task run

- All production nested/leaf delegation enters `runTask` (or identical admission).
- Delete production bypasses to `runFunctionCallingLoop` / `runDelegatedTask` that skip coordinator lifecycle.

### P5 — Parallel tools

- One tool_call: sync; many: parallel pool.
- Force sequential for interactive / HITL / agent-level tools.
- Reinsert tool messages in **original tool_call order**.

### Testing philosophy

- True-import smoke per phase; external behavior at public seams.
- Avoid hand-copied source mirrors except thin drift guards for intercept set / no dual finalize / no bypass ingress.
- P1 big bang requires broad tool smoke or generation-time exhaustiveness checks.
- P2 needs compress shape tests; P5 needs order+sequential-interactive tests.

## Testing Decisions

| Phase | Primary seams to test |
|-------|------------------------|
| P0 | `isAgentLevelTool` / intercept set; `invokeGatedTool` (incl MCP execute adapter); FC wiring; halt rethrow; tool string on deny/throw |
| P1 | registry register/discover; derived definitions completeness; dispatch → invocation |
| P2 | ContextEngine interface with fake + default compress invariants |
| P3 | single orchestrator entry; no public strategy factory requirement for engine |
| P4 | nested path only via runTask; drift-guard against direct loop from delegate |
| P5 | parallel multi-call order; sequential interactive |

Prior art: `smoke-tool-invocation.mts`, `smoke-step-executor.mts`, `smoke-context-governor.mts`, `smoke-approval-decision.mts`.

## Out of Scope

- Reopening ADR-0003 default single-run product policy (P5 is tool-level concurrency only).
- Full Hermes gateway/CLI product parity (messaging platforms, ACP, trajectories training).
- Replacing Approval Decision pure module design.
- OpenCode CLI runner capability matrix expansion.

## Further Notes

- Grilling: original tool-axis B expanded by user to full program (decision 11–21); shared understanding confirmed.
- Related (resolved, P0 builds on these):
  - `.scratch/tool-invocation-pipeline/`
  - `.scratch/tool-invocation-review-cleanup/`
- Index: `.scratch/INDEX.md` · map: `.scratch/hermes-aligned-runtime/map.md`
- Domain terms: Task run, Loop run, Approval Decision, Tool Invocation, agent-level intercept, ContextEngine, registry dispatch.
- Risk callout: P1 big bang + P2 algorithm + P3 orchestration merge are the three highest-risk phases; do not start P1 until P0 smoke is green.
