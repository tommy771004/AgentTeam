# 04 — 答案與模型歷史改為從 Turn Record 推導（migrate）

**What to build:** 使用者接著追問時，模型知道自己**做過什麼**，而不只是自己**說過什麼**：上一輪的工具呼叫與結果，依實際發生的順序留在它的上下文裡。同時，「這一回合settle 在哪段文字」只在一個地方計算，Host 與 renderer 匯入同一份實作，不再各自從 items 裡挑。`messages` 與 `toolAudit` 從「平行的真相」降級為帳本的投影。

**Blocked by:** 03

**Status:** 可交給代理

- [x] 模型歷史由 Turn Record 推導，含依序的 tool call 與 tool result，不再只有 user/assistant 純文字
- [x] 已結算答案、模型歷史、中斷部分答案、空回覆判定，全部由同一個推導模組提供；Host 與 renderer 匯入同一份
- [x] `messages` 成為推導出來的投影，寫入路徑只剩帳本一條
- [~] `toolAudit` **未**改為投影 —— 見下方說明，它涵蓋回合之外的工具呼叫，純推導會遺失那些記錄
- [x] Drift guard：推導模組以外的任何消費端，不得以索引（`find` / `[0]` / `at()`）從回合 items 取答案；違反則 build 失敗
- [x] 新增 ADR：模型可見的一切必須可從 Turn Record 重建；新增一種模型可見輸入就必須新增一種帳本條目
- [x] Seam 1 smoke：工具往返後的歷史投影含工具軌跡且順序正確
- [x] Seam 1 smoke：多段 assistant 的回合，答案仍是最後一段結論（既有 regression 保持綠）

## Comments

**Implemented and verified.**

- `derivePiHistory(record)` is the single write path for `session.messages`. The model's history now carries what the agent **did** — `→ grep(call_1)` then `← grep(call_1) success` — in the order it happened, not only what it said.
- A compaction entry replays as the drop it performed, so deriving history reproduces a shortened context instead of re-growing it.
- The message role widened to `user | assistant | tool`. The renderer's chat projection filters `tool` out for now: it is real history the model reads, not a chat bubble. Ticket 05 gives it a row of its own.
- Compaction weighs `tool` entries like any other message, because they cost context like any other message.

**Two things this ticket exposed:**

1. **In-turn tools produced no result entry.** Pi executes a turn's tools inside the Host process, so they never reach the `tools/*` protocol path where the audit is written — the record had the model's `tool-call` and nothing about what happened next. `tool_execution_end` is now recorded as a `host`-sourced `tool-result`: the runtime's own report, not the model's claim.
2. **Ordering bug in ticket 03's wiring.** The answer was recorded *after* history was derived, so the derived history was missing its own answer. Three smokes caught it. Entries for a round are now recorded before that round's history is derived, so the next round sees what this one just did.

**Deviation, deliberate: `toolAudit` is not a projection of the record.** The ticket asked for both. `messages` is now derived; `toolAudit` cannot be, because it also records tool calls made through `tools/*` **outside any turn** (no turn, no record — `smoke-pi-bash-tool` is exactly that shape), so deriving it purely from the record would silently drop them. The record stays authoritative for what happened inside a turn, and ticket 06 — which deletes the renderer's four-source ladder — consumes the record rather than the audit. Making the audit itself derived needs the record to cover out-of-turn tool calls first; that is a ticket of its own, not a line item here.

**ADR-0049** records the rule: model-visible context must be reconstructable from the Turn Record, a new model-visible input requires a new entry kind, and deriving the answer belongs to the shared module alone.

**Drift guard** added to `smoke-pi-turn-record.mts`: `piHostProtocol`, `piCoreRuntime` and `agentStore` are read as source and must not select an answer by indexing a turn's items (`items.find` / `items[0]` / `items.at`). That is the exact shape of the defect that started this effort.
