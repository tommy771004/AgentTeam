# Tool invocation pipeline：門控工具單一 seam

Status: resolved

## Problem Statement

Loop run 在 **function-calling** 與 **heuristic** 兩條步驟策略上，對「已過門控的工具」各自維護一段 authorize → execute → supervisor → record → afterTool 的收尾邏輯。heuristic 側雖已抽出「核准後收尾」helper，function-calling 的 `executeOneToolCall` 仍是垂直義大利麵；兩條路徑的 parity 只靠註解與人工記憶。

後果：

1. 同一類內建／custom 工具在兩條路徑上，deny、執行失敗、payload 截斷、afterTool 是否觸發等行為容易漂移。
2. 測試必須拉起半套 loop 或複製兩份 smoke，才能鎖「門控工具」行為；沒有單一、可注入 adapter 的高位 seam。
3. 架構 review 已把 **Tool invocation pipeline** 排為最高 leverage 深化項；若不先收斂門控工具，後續把 MCP／delegate／framework 工具納入同一語意時會再造 god module。

使用者／操作者角度：工具被拒、執行炸掉、或 hook 該不該跑，不應取決於這次步驟剛好走了 function-calling 還是 heuristic。

## Solution

新增一個門控工具專用的深模組 **Tool Invocation**，對外只暴露 `invokeGatedTool`：一次呼叫完成 Approval Decision 適配 → 執行 → supervisor（phase 1 僅 truncate）→ 工具呼叫紀錄 →（在已執行路徑上）afterTool。

- **範圍（phase 1）**：只統一**門控工具**中的 **builtin + custom**；框架工具（plan／tool_search／load_capability／run_code 等）與 MCP／delegate 仍留在既有 function-calling 分支。
- **呼叫端順序**：先接 **heuristic** 步驟策略；function-calling 的 builtin／custom 尾巴留到後續 effort。
- **舊 finalize helper**：吸收進此模組，不長期並存雙 API。
- **錯誤模型**：授權 deny／HITL 拒絕與 execute 未預期 throw 皆回**結構化結果**（不丟例外打穿 loop）；deny **不**跑 afterTool。
- **可測性**：`authorize`、`execute`、`evaluateAfterTool` 皆可選注入；supervisor 永遠在模組內。

對齊 Hermes 精神：registry／dispatch 一條路徑給「會執行的工具」；loop 攔截 framework 特例。本產品額外需要結構化結果（UI feed、toolCalls 列表、metrics），因此 interface 不是「只回字串」。

## User Stories

**單一 seam 與語意**

1. As a 開發者, I want one gated-tool entry point that means “run this tool under Approval Decision and the post-exec tail,” so that I do not have to remember separate authorize-then-finalize choreography.
2. As a 開發者, I want framework tools and gated tools to remain conceptually separate, so that progressive-disclosure and plan-mode control flow are not forced into the same module as ordinary tool I/O.
3. As a maintainer, I want MCP and delegate execution to stay out of phase 1, so that the first knife stays demoable without inventing a new god dispatcher.
4. As a 開發者, I want the module’s default path to use real Approval Decision and real executors, so that production wiring is not a special case of the test path.

**Approval Decision 與 deny**

5. As a 使用者 who denies a sensitive tool in HITL, I want the Loop run to receive a normal tool-result-shaped failure rather than an uncaught exception, so that the step can continue or explain the denial cleanly.
6. As an operator reading tool call records, I want denied invocations to still produce a failed ToolCallRecord, so that audit trails show the attempt without implying side effects ran.
7. As a hook author, I want afterTool **not** to fire on pure authorization deny, so that “after execution” rules do not treat non-execution as a completed tool call.
8. As a 開發者, I want policy deny and HITL refuse to share the same structured shape (including an explicit denied marker), so that callers do not special-case two deny mechanisms.

**執行成功／失敗**

9. As a 使用者, I want a successful builtin or custom tool under the heuristic path to still append the same style of tool chunk and record as today, so that this refactor is not a product behavior change for the happy path.
10. As a 開發者, I want unexpected execute throws to become structured `ok: false` results (not loop-crashing exceptions), so that transient I/O failures look like tool failures to the model and UI.
11. As a hook author, I want afterTool to run after an attempted execution that returned failure or was wrapped from a throw, so that post-exec audit still sees “ran but failed.”
12. As a 開發者, I want to inject a fake execute function in tests, so that I can lock success, soft-fail, and throw paths without Electron IPC.

**Supervisor／payload**

13. As a security-conscious maintainer, I want payload truncation to always run inside the gated-tool seam, so that neither heuristic nor a future function-calling caller can forget enforce.
14. As a 開發者, I want phase 1 to support truncate only (not halt-as-new-semantics), so that we do not invent a structured mapping for SupervisorViolation while the only production caller uses truncate.
15. As an operator, I want oversized tool outputs to remain truncated with the same supervisor posture as the current heuristic finalize path, so that context windows do not regress.

**Adapter 注入與測試**

16. As a 開發者, I want authorize to be an injectable adapter with a production default into the real guard, so that smoke tests can force allow／deny／ask outcomes without permission stores.
17. As a 開發者, I want evaluateAfterTool (and notify) to be injectable, so that tests can spy or no-op hooks without loading the full hook rule engine.
18. As a reviewer, I want smoke tests to true-import the invocation module and assert only external results (return shape, whether afterTool ran, record.ok／denied), so that we do not reintroduce hand-copied source mirrors.

**Heuristic 接線與舊 API 退役**

19. As a 開發者 on the heuristic step strategy, I want builtin and custom tools to call the new seam end-to-end, so that production actually exercises the module in phase 1.
20. As a maintainer, I want the old post-authorization finalize helpers absorbed (no long dual-API period), so that parity cannot drift between two “official” tails.
21. As a 開發者 maintaining step-executor smoke, I want existing finalize-oriented cases rewritten against the new seam or heuristic wiring, so that green smoke still means the production path is covered.
22. As a product owner, I want function-calling’s private tool tail left unchanged in phase 1, so that the highest-risk god module is not edited until the new seam is proven on heuristic.

**後續（本 spec 記載意圖，phase 1 不交付）**

23. As a 開發者, I want a clear phase-2 story where function-calling builtin／custom branches call the same seam, so that dual tails are eventually deleted rather than permanently “heuristic-only.”
24. As a 開發者, I want the internal handler-table shape to leave room for MCP later, so that phase 2／3 does not require a second public API.

**跨切**

25. As a product owner, I want no intentional user-visible product change beyond consistent structured failures and hook semantics already described, so that this is an internal deepening with locked regression via smoke.
26. As a domain author, I want vocabulary to stay aligned with Approval Decision, Loop run, ToolCallRecord, and gated vs framework tools, so that future tickets do not rename the seam casually.

## Implementation Decisions

Grill-locked decisions (2026-07-20); phase 1 only unless noted.

1. **Scope**: Gated tools only — not framework tools in the same module surface.
2. **Seam**: New Tool Invocation module; primary export `invokeGatedTool`. Not “thicken finalize only,” not “private helper inside the function-calling loop only.”
3. **Authorize**: Injectable `authorize` adapter; production default wires the existing Approval Decision guard path (HITL remains outside pure decide, as today).
4. **Execute kinds (phase 1)**: Builtin + custom only; internal handler-table shape may anticipate more kinds; MCP／delegate stay on existing function-calling branches.
5. **Caller order**: Heuristic first; function-calling later.
6. **Return shape**: Structured result, conceptually `{ ok, output, record, chunk, denied? }` (names may match existing finalize result fields where useful). Callers append tool messages from this shape.
7. **afterTool**: Injectable `evaluateAfterTool`; production default evaluates real hook rules. Runs on executed paths (success or failure); **does not** run on authorization／HITL deny.
8. **Deny**: Structured result, no throw. Explicit denied marker so callers／tests distinguish deny from execute failure.
9. **Execute throw**: Catch and return structured `ok: false` (denied false); loop continues.
10. **Legacy finalize**: Absorb into the new module; no intentional long-lived dual public API (same-PR thin re-export only if required to keep the tree green mid-edit, then remove).
11. **Supervisor**: Always inside `invokeGatedTool`; limits parameter with default supervisor limits.
12. **Halt**: Phase 1 **truncate only**. Do not invent halt→structured semantics; if a halt flag is exposed later, rethrow named supervisor violation rather than silently mapping to tool failure.
13. **Execute injection**: Optional single `execute` (or resolve-execute) override for tests; production default dispatches builtin／custom to real executors.
14. **No ADR**: Reversible internal deepening; product vocabulary already has Approval Decision; this adds a module seam, not a new user-facing mode.

**Suggested return shape (decision-rich, from grilling — not a prototype demo):**

```text
invokeGatedTool(input) → {
  ok: boolean
  output: string
  record: ToolCallRecord
  chunk: string
  denied?: boolean   // true only for auth / HITL refuse
}
```

**Pipeline order (locked):**

```text
authorize → (if denied: record + return, no afterTool)
         → execute (catch throw → structured fail)
         → supervisor truncate
         → record
         → afterTool (executed paths only)
         → return structured result
```

## Testing Decisions

**What makes a good test here**

- True-import the Tool Invocation module (and, for the wiring ticket, the heuristic strategy or its existing smoke entry).
- Assert **external behavior**: return fields, whether `evaluateAfterTool` was invoked, record.ok／output／denied, truncate effect on oversized output.
- Prefer injected fakes for authorize／execute／afterTool over standing up permission stores, Electron IPC, or a full function-calling loop.
- Do **not** lock behavior by grepping production source strings (“hand-copied mirrors”).

**Primary seam (ideal: one)**

- **`invokeGatedTool`** is the highest test seam for all phase-1 behavioral locks (deny, allow, throw wrap, afterTool on／off, truncate).
- Secondary: heuristic step strategy smoke only to prove **production wiring** and that old finalize exports are gone — not to re-test every branch already covered at `invokeGatedTool`.

**Prior art**

- `smoke-approval-decision.mts` — pure decision + adapter split, true import.
- `smoke-step-executor.mts` — finalize／preload helpers and strategy wiring.
- `smoke-context-governor.mts` — injected deps factory pattern.

**Minimum smoke coverage (phase 1)**

1. Authorize deny → structured denied result; afterTool **not** called; record.ok false.
2. Allow + execute success → ok true; afterTool called with toolOk true.
3. Allow + execute returns soft fail → ok false; afterTool called with toolOk false.
4. Allow + execute throws → structured ok false, not an unhandled rejection; afterTool still called (executed-path).
5. Oversized output → truncated under default／injected limits.
6. Heuristic path uses the seam for builtin and custom (no remaining production dependence on the absorbed finalize helpers).

## Out of Scope

- Migrating function-calling `executeOneToolCall` builtin／custom tails onto `invokeGatedTool` (phase 2).
- MCP, delegate_task, code-mode inner tools, or framework tools (plan enter／exit, tool_search, load_capability, run_code) inside this module in phase 1.
- Changing Approval Decision layer ordering or HITL UX.
- Supervisor **halt** semantics and `SupervisorViolation` product behavior redesign.
- Nested delegate Loop-run vs Task-run admission (separate architecture candidate).
- Engine path selection (FC vs heuristic vs simulation) or Loop Pattern orchestration.
- User-facing copy, settings fields, or Approval Mode UI.

## Further Notes

- **Domain terms**: Approval Decision; Loop run; heuristic vs function-calling step strategy; gated tool vs framework tool; ToolCallRecord; afterTool hook.
- **Hermes alignment (mental model only)**: one dispatch for ordinary tools; loop intercepts framework exceptions. This product returns structured results for UI／metrics, not Hermes-only strings.
- **Grilling**: decisions 1–16 locked 2026-07-20; shared understanding confirmed before this spec.
- **Suggested module home** (non-binding for implementers if better locality appears): tools layer beside the approval guard and tool loop — export `invokeGatedTool` + result types only.
- **Phase 2 sketch** (not tickets here): point function-calling builtin／custom through the same seam; leave MCP／delegate／framework as explicit non-gated or separate adapters until a later effort.
