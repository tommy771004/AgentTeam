# 02 — 被停止的回合保留敘述與部分答案的邊界

**What to build:** 使用者中途按下停止（或回合被 per-turn deadline 停下）之後，拿到的是「到目前為止的答案」本身，而不是把開場白、中段自言自語與最後半句焊成一坨的字串。回合開始時說的「我先探索本地專案結構…」留在執行過程裡，答案區只放最後那一段實際在寫的內容；兩者在使用者眼裡是兩件事，在記錄上也是兩個欄位。

**Blocked by:** 01（結算聯集的 `interrupted` 變體要先能分開承載「部分答案」與「敘述」）

**Status:** 可交給代理

- [x] 中斷結算攜帶的部分答案是最後一段 assistant 文字，不是所有片段的串接
- [x] 中斷前的敘述仍可從執行過程讀到，不會憑空消失
- [x] 逾時中斷與使用者中斷走同一條保留路徑，兩者的措辭在 UI 上仍可區分
- [x] 完全沒有任何 assistant 文字時的中斷，結算不會退化成 `empty` 的成功語意
- [x] Seam 1 smoke：腳本化「敘述 → 工具 → 中斷」，斷言部分答案不含開場白
- [x] `npm run build`、`npm run smoke:pi-host` 全綠

## Comments

**Implemented and verified.**

The join was in two places, not one:

1. `interruptedTurnResult` welded every assistant message with `\n`. Each assistant message is now its own item, so the message the model was writing when it stopped stays separable from the ones before it.
2. The streamed-delta rebuild (added alongside this effort, `smoke-pi-turn-final-answer-delta-fallback.mts`) concatenated **every** `text_delta` in the turn. Deltas now segment at message boundaries — `message_start`, `tool_execution_start`, and a completed `assistant_message` each end a message — and the answer is the last segment.

Found while writing the smoke: a stop lands before `agent_end` fires, so `completedMessages` is empty and the partial would have been lost entirely. `runPiTurn` now accumulates what streamed in, one segment per message, and an interrupted turn falls back to that — still one item per message, never a weld.

Also replaced the protocol's `turn.items.map(...).join('\n')` result derivation with `piTurnResultText(settlement, items)`, which switches exhaustively: a stopped turn reports the message it was writing, a failed one reports the error its items carry.

**Changed another in-flight decision, deliberately.** `smoke-pi-turn-final-answer-delta-fallback.mts` asserted that the rebuild keeps preamble *and* conclusion, on the rationale that both are "what the user watched arrive in the feed". That rationale is right about the feed and wrong about the answer position: the narration is still in the feed (this ticket's smoke asserts it), while the answer holds only the last message. The assertion was updated with that reasoning inline, pointing back at this ticket.
