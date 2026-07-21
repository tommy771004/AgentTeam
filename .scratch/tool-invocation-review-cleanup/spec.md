# Tool Invocation phase 1 — code-review 收斂

Status: resolved

## Problem Statement

門控 Tool Invocation phase 1（`invokeGatedTool` + heuristic 接線 + 吸收 finalize）行為與 smoke 已綠，但嚴格 code-review **不批准**：接線把「雙尾巴」收成單一 seam 後，heuristic 策略裡又出現 **builtin / custom 兩套幾乎相同的 `invokeGatedTool` 組裝**，呼叫端仍複製 authorize remap、onRecord、afterTool、notify 等 boilerplate。複雜度被搬家，沒有被刪掉。

同輪還留下：

1. 每個 call site 手寫 `AuthorizeResult → GatedAuthorizeResult` ternary（+ `as const`）。
2. 死契約／死碼：`InvokeGatedToolInput.settings` 未讀取；`authToDeniedResult` 零引用；`guardAndExecuteTool` 在 heuristic 搬走後全庫零呼叫。
3. `denied?: boolean` 可選，成功路徑為 `undefined`，契約比「永遠 boolean」難推理。
4. heuristic 經新 seam **永遠 truncate**，但 Settings 的 `haltOnPayloadOverflow` 仍暗示對所有路徑生效（FC 仍 halt）；phase 1 決策未在程式邊界寫清楚。
5. builtin execute 使用 `tool as Parameters<typeof executeTool>[0]` 糊型別邊界。

若不收斂，phase 2 把 FC 接上同一 seam 時會複製第三套 loop 組裝，結構債加倍。

## Solution

在 **不改 phase 1 產品語意**（結構化 deny／throw、deny 不 afterTool、supervisor truncate-only、builtin+custom only、FC 不動）的前提下：

1. **刪掉 heuristic 雙 loop 組裝**——抽單一本地（或同層）helper，builtin／custom 只差 execute 與少數 auth 旗標。
2. **收緊 `invokeGatedTool` 契約**——`denied` 必為 boolean；拿掉未使用的 `settings`；authorize 結果形狀與既有 Authorization／guard 對齊，呼叫端不再 remap。
3. **清死碼**——刪未使用的 finalize 殘留 helper 與（確認無呼叫後的）`guardAndExecuteTool`，或若保留須有明確唯一用途註解（本 spec 預設刪）。
4. **寫清 truncate-only**——模組與 heuristic 接線註解（必要時 deny／成功路徑不靜默假裝 halt 生效）。
5. **型別邊界**——builtin 工具名以既有 `ToolName`（或 registry 回傳型）進入 execute，去掉 `Parameters<typeof …>` cast。

## User Stories

1. As a 開發者 reading the heuristic strategy, I want one shared assembly for gated tool calls, so that builtin and custom do not each re-implement authorize/record/afterTool wiring.
2. As a 開發者 calling `invokeGatedTool`, I want authorize results to match the guard’s allow/deny shape without a local remap, so that every new call site cannot invent a third conversion.
3. As a 開發者 inspecting a structured result, I want `denied` to always be a boolean, so that metrics and tests never special-case `undefined`.
4. As a 開發者, I want unused input fields removed from the public input type, so that the interface does not advertise a settings-driven default path that does not exist.
5. As a maintainer, I want dead post-auth helpers and unused guard+execute entry points removed once heuristic no longer calls them, so that “canonical path” search does not land on orphans.
6. As a 開發者, I want phase-1 truncate-only supervisor behavior documented at the seam, so that nobody “fixes” heuristic by re-adding halt mid-wiring without a deliberate ticket.
7. As a 開發者, I want builtin tool names typed without cast at the execute boundary, so that the registry→executor path stays honest.
8. As a reviewer, I want smoke to still true-import `invokeGatedTool` for behavior, and wiring checks to assert a single heuristic assembly path (not two copy-pasted loops), so that the dual-loop regression cannot return silently.
9. As a product owner, I want no intentional change to deny/throw/afterTool/truncate product behavior from phase 1, so that this effort is structure-only relative to the resolved parent pipeline.
10. As a 開發者 planning phase 2, I want the heuristic call site thin enough that FC can later call the same seam without copying strategy boilerplate, so that phase 2 is “point the branch,” not “invent a third assembler.”

## Implementation Decisions

- **Parent:** `.scratch/tool-invocation-pipeline/` (phase 1 resolved). This effort is review remediation only.
- **Behavior freeze:** Keep phase 1 grill locks (structured deny/throw, no afterTool on deny, truncate only, adapters required at call sites, FC out of scope).
- **Adapters:** Prefer **required** `authorize` / `execute` (and optional `evaluateAfterTool`) — do not reintroduce unused “default via settings” fields. Align comments/spec language with forced injection (deeper, testable).
- **Authorize shape:** Accept the same allow/deny discriminant the guard already returns (or a one-line normalizer **inside** the invocation module). Call sites must not each implement ternary remap.
- **`denied`:** Always `boolean` on the result type.
- **Heuristic helper:** One function owns building authorize closure + invokeGatedTool options + onRecord/afterTool/notify; loops only supply tool name, input, forceAsk/sideEffect, and execute. Prefer local to the strategy module unless a second production caller appears.
- **Dead code:** Delete `authToDeniedResult` if still unused; delete `guardAndExecuteTool` if still zero call sites after verification (grep-backed). If a future FC ticket needs auth+execute combo, reintroduce next to the FC migration—not as orphan.
- **Halt:** No new halt semantics. Document truncate-only on the seam; do not silently re-enable halt on heuristic in this effort.
- **No ADR:** Internal cleanup after review; reversible.

## Testing Decisions

**Good tests:** external behavior at `invokeGatedTool` (already exist); update assertions for `denied === false` on non-deny paths. Prefer true-import. Avoid new hand-copied mirrors of large strategy files except thin drift guards that prove **one** assembly helper name is used and dual finalize/orphan APIs stay gone.

**Seams:**

1. **`invokeGatedTool`** — contract changes (`denied` always set; authorize shape).
2. **Heuristic gated assembly helper** (name TBD at implement time) — single place builtin/custom share; smoke or drift-guard asserts both paths go through it.

**Prior art:** `smoke-tool-invocation.mts`, `smoke-step-executor.mts` wiring section.

**Minimum coverage:**

1. Existing tool-invocation cases still green with `denied: true|false` explicit.
2. Authorize path works when adapter returns guard-shaped results (no call-site remap required).
3. Wiring: heuristic uses one assembly helper; no second full `invokeGatedTool({…})` duplicate block for custom vs builtin (structural assert or helper unit coverage).
4. Grep/true-import: removed dead exports stay gone.

## Out of Scope

- Function-calling `executeOneToolCall` migration onto `invokeGatedTool` (phase 2).
- MCP / delegate / framework tools inside the gated module.
- Re-enabling or redesigning supervisor **halt** product behavior.
- Engine path selection, Loop Pattern, Approval Decision layer order.
- Large stepStrategies decomposition beyond the gated-tool dual loop.

## Further Notes

- Review verdict was **Request changes**; this spec is the remediation plan.
- Suggested implementation order matches review: (1) contract + single heuristic assembly, (2) dead code + halt note + cast.
- Domain terms: Approval Decision, gated tool, heuristic step strategy, ToolCallRecord, afterTool.
