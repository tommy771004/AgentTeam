# Run progress lifecycle：Codex 與 OpenCode 的生命週期、事件流與 UI 投影

研究日期：2026-08-26  
範圍：只使用兩個官方 repo 的原始碼與官方 repo 內文件，不使用二手資料。  
基準版本：

- OpenAI Codex：[`a95391160ad24d0e84914b7b847422254fecac3a`](https://github.com/openai/codex/commit/a95391160ad24d0e84914b7b847422254fecac3a)
- anomalyco/opencode：[`8615731d46153dd29b89e205fb55b2cc16205cb0`](https://github.com/anomalyco/opencode/commit/8615731d46153dd29b89e205fb55b2cc16205cb0)

## 結論先行

執行進度只顯示 `Pi Core Host turn` 確實不合理。問題不是這個字串完全不能存在，而是它只描述「哪個 runtime 在跑」，沒有回答使用者正在等的事：現在是思考、輸出訊息、執行哪個工具、等候批准、重試、收尾、中斷，還是已失敗。

Codex 與 OpenCode 都沒有用假百分比解決這件事。兩者共同採用兩層模型：

1. **粗粒度 lifecycle**：run/turn/session 只回答 running、completed、interrupted、failed、retry 等少數狀態。
2. **細粒度 timeline**：reasoning、assistant text、tool call、tool output、file change、plan、error 等各自有 stable identity、start/delta/end 或 pending/running/completed/error 狀態，UI 從這條事件流投影出真正進度。

因此 `Pi Core Host turn` 最多只能降為 runtime metadata。使用者可見的主進度應由現有 Turn Record / live timeline 投影，例如「思考中」、「執行 shell：npm run build」、「等待工具結果」、「正在重試（2/…）」、「已中斷」。

## 對照摘要

| 面向 | OpenAI Codex | OpenCode | 對本專案的含義 |
|---|---|---|---|
| 頂層狀態 | Turn：`inProgress / completed / interrupted / failed` | Session：`idle / busy / retry` | 保持少而封閉，不加入大量 UI 文案狀態 |
| 細粒度單位 | `ThreadItem`，每項 `started → deltas → completed` | message parts；text/reasoning/tool/step 各有事件 | 主進度來自 timeline item，不來自 runner 名稱 |
| 串流文字 | `itemId` scoped delta；completed item 權威覆核 | part delta；end/full part 權威 | delta 可丟、可節流；完成態不得靠 delta 猜 |
| 工具 | item 有 `inProgress/completed/failed/declined` | tool part 有 `pending/running/completed/error` | 同一 item/card 原地 transition，不要每次另加 status 行 |
| 重試 | retryable stream error 與 terminal failure 分開 | `retry` 狀態含 attempt/message/next | 重試是可見且非 terminal 的狀態 |
| 取消 | `turn/interrupt`，以 terminal `turn/completed: interrupted` 確認；背景 terminal 不自動停 | cancel runner 並清理未完成 part，也遞迴取消關聯 background jobs | 必須明定取消邊界；不可收到按鈕回應就假設已停止 |
| 防 stale | thread/turn/item ID、精確 turn routing、transition/dedupe、completed authoritative | generation、part identity、transition guard、tombstone、live-over-fetch merge | 至少需要 runId/turnId/itemId + terminal guard + reconnect reconciliation |
| UI | `Working` 只是底部旗標；timeline 同時顯示 message/reasoning/tool | busy 顯示 Thinking，另有 reasoning/text/tool/retry/error row | 泛用 busy label 可保留，但不能成為唯一內容 |

## OpenAI Codex

### 1. Turn 是封閉的粗粒度狀態機

Codex app-server 的 `TurnStatus` 只有 `Completed / Interrupted / Failed / InProgress`。Turn 自身另帶 ID、items、error、start/end/duration；它不是把每種工作階段都塞成一個 status 字串。[TurnStatus](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L27-L35) [Turn DTO](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L350-L396)

官方 app-server 文件把生命週期寫得很清楚：一個 turn 從 `turn/started` 開始，以 `turn/completed` 結束；每個細項一律是 `item/started → 0..n deltas → item/completed`。`turn/completed` 只帶 final agent message 作 summary fallback，完整時間軸仍應持續消費 `item/*`。[turn/item lifecycle](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server/README.md#L1627-L1639)

這代表 turn status 是 admission/settlement 用的外框，不是使用者進度敘事。

### 2. 真正的進度是 typed item timeline

`ThreadItem` 是 discriminated union，包含 agent message、reasoning、command execution、file change、MCP tool call 等；command 與 tool 自己攜帶狀態和結果欄位。[ThreadItem message/reasoning/command/file/MCP](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L228-L332)

文件進一步說明：

- `agentMessage` 可是一般訊息，也可用 `delivery: async` 表示不結束 turn 的可見訊息。
- `reasoning` 有 summary/content。
- command、file change、MCP、collab tool 都有各自的 in-progress/terminal 狀態。
- subagent completion 甚至可能晚於 parent turn 的 `turn/completed`，但仍歸屬原 turn。

證據：[item semantics](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server/README.md#L1643-L1668)

最後一點很重要：**turn terminal 不等於所有非同步子工作都已消失**。投影器必須靠 `(threadId, turnId, itemId)` 歸屬 late event，不能把「目前 active turn」當唯一寫入目標。

### 3. Delta 即時、completed authoritative

Codex 把 agent text、reasoning summary/raw text、command output 等 delta 映成帶 `threadId + turnId + itemId` 的 notification；item start/completion 則帶完整 item。[event mapping](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server-protocol/src/protocol/event_mapping.rs#L355-L470)

官方文件明定 `item/completed` 是權威 execution/result state，agent delta 只需按同一 `itemId` 依序串接。[authoritative completion](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server/README.md#L1670-L1684)

TUI 也遵守這個契約：delta 立即送進 stream controller，但 item completion 會用完整 message consolidation，避免 transport 飽和時漏掉 delta 造成 transcript 截斷。[TUI completion reconciliation](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/chatwidget/streaming.rs#L125-L143)

因此本專案不該把每個 delta 都視為 durable truth。正確分工是：

- live delta：低延遲、可 coalesce、可 bounded；
- completed item / Turn Record entry：完整、可 replay、是最終權威。

### 4. UI 同時消費 turn、item 與 delta

Codex TUI 收到 `TurnStarted` 時啟動 task flag；`ItemStarted/Completed` 分派到 command、file change、MCP、web search 等 presenter；agent/reasoning/command output delta 則更新正在顯示的 item。[notification projection](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/chatwidget/protocol.rs#L43-L100) [item presenters](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/chatwidget/protocol.rs#L344-L401)

Turn completion 再依 `Completed / Interrupted / Failed` 做不同 settlement；成功時還以 `(turnId,itemId)` 去重 final message，避免 replay/live 重複插入。[turn UI settlement](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/chatwidget/protocol.rs#L260-L341)

TUI 在 turn start 的確也會顯示泛用 `Working`，但同時清理前一 turn 狀態、開啟 interrupt hint、初始化 reasoning buffers，並由上述 timeline 持續提供細節。[task-start UI state](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/chatwidget/turn_runtime.rs#L68-L101) 所以「Working 類標籤」本身不是問題，**只有它而沒有 item timeline** 才是問題。

### 5. Error、retry 與 cancel 不混在一起

Codex 把 retryable `StreamError` 發為 `ErrorNotification { will_retry: true }`，刻意不改 terminal turn summary；真正影響 turn 的 error 才走 terminal error path。[retryable vs terminal error](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server/src/bespoke_event_handling.rs#L939-L995) TUI 對 `will_retry` 顯示 stream retry 狀態，非 retry error 才進 failure handling。[TUI error projection](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/chatwidget/protocol.rs#L126-L143)

取消不是呼叫 `interrupt` 後立刻在 UI 自己標 finished。官方契約要求等待 terminal `turn/completed` 且 status 為 `interrupted`；此外 interrupt 不會終止 background terminals。[interrupt contract](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server/README.md#L1190-L1202) Server 端也先驗證請求的 `turnId` 確實等於 active turn，再提交 interrupt，避免取消錯 turn。[interrupt turn guard](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server/src/request_processors/turn_processor.rs#L1507-L1552)

### 6. Race / stale update 防護

Codex 的關鍵手法：

- Command completion 可能晚到；history reducer 依 event 自帶的 `turn_id` 回寫原 turn，而不是寫到當前 turn。[late command routing](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L655-L670)
- Turn abort/complete 優先用 exact ID 命中 active 或 historical turn，再做有限 fallback。[turn terminal routing](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L1206-L1302)
- Replay buffer 只合併**相鄰且 thread/turn/item 全相同**的 agent delta；同時受事件數與 bytes 上限控制。[bounded scoped coalescing](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/app/thread_event_buffer.rs#L8-L76)
- `TurnCompleted` 只有在 ID 等於 store 的 `active_turn_id` 時才清除 active 狀態，舊 turn 的晚到 terminal 不會誤停新 turn。[active turn guard](https://github.com/openai/codex/blob/a95391160ad24d0e84914b7b847422254fecac3a/codex-rs/tui/src/app/thread_events.rs#L123-L141)

## OpenCode

### 1. Session status 更粗，但 retry 是一級狀態

OpenCode 的 session status 只有 `idle / busy / retry`；retry 額外帶 attempt、message、next 與 action。舊 `session.idle` 已 deprecated，正式來源是 `session.status`。[status schema](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/schema/src/session-status-event.ts#L9-L51)

Status service 在 idle 時發 event 後直接從 map 刪除，查不到就回 idle；finished state 不永久堆積。[status service](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/status.ts#L26-L48)

每個 sessionID 綁唯一 Runner；開始設 busy，idle 時先移除 runner 再發 idle，scope finalizer 會取消所有 runners。[run ownership](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/run-state.ts#L35-L105) Session run 內部仍可進行多個 model steps，直到 assistant 已有終止 finish 且沒有待回送 tool result 才離開 loop。[multi-step prompt loop](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/prompt.ts#L1081-L1130)

### 2. Message/part timeline 是真正進度

目前正式投影事件包含 `message.updated`、`message.part.updated`、`message.part.delta`、part removal 與 `session.error`；delta identity 是 `{sessionID,messageID,partID,field}`。[v1 events](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/schema/src/v1/session.ts#L596-L675) 所有完整 part 寫入與 delta 發布也集中經過 session service seam。[part publish](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/session.ts#L629-L643) [delta publish](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/session.ts#L877-L885)

下一代 schema 把語意分得更清楚：text/reasoning delta 是 live-only，Ended 帶完整文字且可 replay；tool progress 是 bounded checkpoint，不持久化每個 stdout chunk；tool terminal 明分 Success / Failed。[text/reasoning lifecycle](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/schema/src/session-event.ts#L197-L270) [tool lifecycle](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/schema/src/session-event.ts#L273-L372) [durable/live-only inventory](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/schema/src/session-event.ts#L448-L504)

### 3. 各 part 有明確 transition

- Reasoning：start 建 part；只有 start 已存在才接受 delta，孤兒 delta 丟棄；end 寫完整 part 和 end time。[reasoning lifecycle](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/processor.ts#L278-L313)
- Tool：先 pending，再 running；result/error 只接受 running 狀態，擋掉 late/stale terminal，並保留 streaming metadata。[tool transition guards](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/processor.ts#L160-L205) [tool stream mapping](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/processor.ts#L315-L418)
- Text：delta 即時發布；end 寫完整 authoritative text 與 end time。[text delta/end](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/processor.ts#L500-L531)
- Retry：每次失敗更新含 attempt/message/next 的 retry status，不偽裝成一般 busy。[retry lifecycle](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/processor.ts#L647-L676)
- Error：發布 `session.error`、寫入 assistant error，最後設 idle。[error settlement](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/processor.ts#L599-L625)

### 4. Cancel 會先 settlement 未完成 part

HTTP abort 會取消 session runner；OpenCode 還會遞迴取消與 session/parent session 關聯的 background jobs。[abort endpoint](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts#L232-L235) [runner/background cancellation](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/run-state.ts#L77-L130)

Processor interrupt cleanup 會封存未完成 text/reasoning，短暫等待 tool settlement，仍未完成的 tool 改成 `error: Tool execution aborted` 並標 `metadata.interrupted`，最後才補 assistant completed time。[interrupt cleanup](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/session/processor.ts#L539-L597)

這比「把全域 running flag 改成 idle」可靠，因為 UI 不會留下永遠 running 的 tool card。

### 5. SSE 與前端 batching 保留語意順序

Server 在開始 response body 前先註冊 listener，避免 startup gap；queue 保序，有 heartbeat，disconnect finalizer 會 unsubscribe。[SSE server](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts#L25-L85)

Client 每 16ms 批次刷新，但只 coalesce 相鄰且 directory/message/part/field 相同的 delta，不跨 lifecycle/terminal event 合併。[delta coalescing](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-sdk.tsx#L59-L138) [16ms flush](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-sdk.tsx#L217-L251)

SSE loop 用 `AbortController + generation`。Stop 會先 generation++ 再 abort，舊 async loop 即使稍後醒來也不能復活；斷線後 reconnect，密集 event 處理會主動 yield 給 UI。[stream generation guard](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-sdk.tsx#L253-L323)

重連收到 `server.connected` 後會補抓 active sessions 並重建 busy 狀態，不相信 renderer 斷線前的記憶。[reconnect reconciliation](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-sync.tsx#L531-L569)

### 6. Fetch 與 live event 併發時，live 必須贏

OpenCode 的前端 store 對最常見的 stale race 有完整防護：

- REST/session fetch 帶 generation token，舊請求結果不得覆蓋新請求。[fetch generation](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-session.ts#L304-L334)
- 歷史 page fetch 期間記錄 live touched/tombstone；page 回來 merge 時保留 live 值，舊 snapshot 不得倒灌。[live-over-fetch merge](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-session.ts#L620-L730)
- Parent message 不存在的 orphan part 直接拒絕；完整 `part.updated` 清除 delta accumulator；removal 留 tombstone。[orphan/full-update handling](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-session.ts#L1094-L1150) [removal tombstone](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-session.ts#L1152-L1188)
- Delta 只套到已存在 part，並用 base/accumulator 防止 full fetch 和 live delta 重複疊加。[delta accumulator](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-session.ts#L1190-L1231)
- v2 reducer 用 assistantMessageID+ordinal 定位 text/reasoning、callID 定位 tool，並以 transition guard 阻擋不合法 terminal。[v2 reducer](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/context/server-session-v2-reducer.ts#L118-L334)

### 7. UI 投影顯示語意，不顯示 runner 名稱

OpenCode timeline 在 user turn 下排列 assistant parts：中斷有 divider；active busy 顯示 Thinking；retry 有獨立 retry row；非 abort error 有 error card；diff 等 settled 後才顯示。[timeline rows](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/app/src/pages/session/timeline/rows.ts#L105-L231)

Text/reasoning 讀 live delta accumulator，assistant 尚無 `time.completed` 就視為 streaming；tool UI 直接接收 pending/running/completed/error，error 有專屬 card。[text streaming projection](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/session-ui/src/components/message-part.tsx#L1654-L1707) [reasoning projection](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/session-ui/src/components/message-part.tsx#L1759-L1773) [tool projection](https://github.com/anomalyco/opencode/blob/8615731d46153dd29b89e205fb55b2cc16205cb0/packages/session-ui/src/components/message-part.tsx#L1534-L1632)

## 建議的產品契約

### 使用者看見的層級

1. **Run banner**：執行中、重試中、等待使用者、正在停止、完成、已中斷、失敗。
2. **Current activity**：由最新 active timeline item 推導，例如思考中、正在執行工具、正在產生回應。
3. **Timeline**：reasoning、assistant message、tool call/result、plan、approval、error、interrupt、complete 按 record seq 排列。
4. **Runtime metadata**：`Pi Core Host`、model、provider、turn ID 放在次要資訊，不作主進度。

不要顯示假百分比。若沒有可量化工作總量，就顯示狀態、目前 action、elapsed time 與已完成 item 數。

### 最小事件契約

所有事件至少需要：

```ts
type RunEventEnvelope = {
  runId: string
  threadId: string
  turnId: string
  seq: number
  emittedAt: number
  itemId?: string
  kind: string
}
```

建議語意事件：

- `turn.started`
- `reasoning.started | delta | completed`
- `message.started | delta | completed`
- `tool.started | progress | completed | failed | declined`
- `retry.scheduled`
- `approval.requested | resolved`
- `turn.interrupting`
- `turn.completed | interrupted | failed`

`delta/progress` 可以節流與 coalesce；所有 start、completed、failed、declined、retry、approval、interrupt、terminal event 不可被 coalesce 掉。Durable record 應保存 completed item/full text 與有意義的 bounded checkpoint，不必保存每個 UI repaint chunk。

### 必要 invariants

1. Terminal turn 只可 settlement 一次；terminal 後同 run 的非明確 late-child event 不得改變結果。
2. Item transition 必須受 guard：例如 tool 只允許 `pending → running → completed|failed|declined`。
3. 任何 update 都按 `(runId, turnId, itemId)` 路由，不得只寫「目前 active item」。
4. 完整 completed item 覆核 live delta，不能假設 delta 永不掉包。
5. Replay 與 live 使用同一 pure projection。
6. Cancel 先進 `interrupting`，等 Host terminal ack 後才變 `interrupted`；並明定 background process 是否一併終止。
7. Reconnect 必須從 Host snapshot/Turn Record 重建 active state。
8. Fetch/replay 與 live event 競爭時，generation 較新的 live state 勝；removal 要有 tombstone。
9. Queue/steer/follow-up 只在上一 turn unique finalization 且 slot release 後推進下一個，避免舊 terminal 清掉新 run。

## 建議實作順序

### 目前本專案與 upstream 契約的可落地差距

研究整合時，本專案已完成一個正確的第一層修正：Pi Host 以 `host/record-append` 發出帶既定 `seq` 的 entry；renderer 驗證 frame、按 seq 去重排序並保存 bounded tail；`projectLiveTimeline → projectTrajectory → runTimelineRows` 讓 live/replay 共用投影；InlineRunPanel 也已改讀這條 timeline。Host 另有 `sessions/record(before, limit)` cursor API，`TrajectoryPanel` 可向前翻頁。這些已對齊 Codex 的 item identity/completed-authoritative 與 OpenCode 的 bounded live stream。

仍需補齊的差距，依風險排序：

1. **缺少 reconnect snapshot + live handoff**：live `recordEntries` 仍是 renderer 看過的 ephemeral tail。renderer reload、IPC 重連或切換 run 後，尚未看到「先抓 Host 最新 page，再從該 page cursor/high-watermark 接 live append」的單一流程。現在 durable paging 與 live append 是兩個 UI surface 各自消費，還不是 upstream 的 snapshot+event reconciliation。
2. **Cursor page 沒有 generation guard**：`TrajectoryPanel` 的 async `read(sessionId,before)` 直接 `setPage`。如果 session 快速切換或較舊請求晚回，舊 page 有機會覆蓋新 session；OpenCode 用 generation + abort 解這一類 race。
3. **Page merge 尚未與 live touched/tombstone 協調**：older page 目前直接 prepend。當 completed item/full message 與 live delta 同時抵達時，需要 seq/item identity 去重，並保證 full completed entry 覆核 delta，而不是重複或倒灌。
4. **`recordTotal` 應由 Host snapshot/high-watermark 校準**：目前 renderer 以「本次 buffer 新增幾筆」累加。若未來 reconnect backfill 含已被 bounded tail 丟掉的舊 seq，單靠當前 buffer 的 `known seq` 會把 backfill 當新事件而膨脹 total。Snapshot 應攜 `total` 或 `latestSeq`，renderer 取 monotonic max。
5. **Item lifecycle 需要 terminal qualification**：tool-call/result 已能按 `callId` 折成同一列，但仍應逐一證明 cancel、deny、Host crash、timeout、retry exhausted 都會 settlement 所有 pending item，且 terminal 後 late success 不會把 failed/cancelled 改回成功。OpenCode 的 processor cleanup 與 Codex 的 exact-turn terminal routing 是最低基準。
6. **Retry 仍需一級語意**：若只有一般 error/status 文案，UI 無法可靠區分 transient stream retry 與 terminal failure。應在 record 或至少 live envelope 表達 attempt、reason、next retry time，且不得讓 retry 提前終止 run。

建議的 reconnect 演算法：

```text
subscribe(runId) and capture connectionGeneration
  → read latest Host record page { entries, total, nextBefore, latestSeq }
  → buffer subscription 期間收到的 append
  → 只在 generation 仍相同時 install snapshot
  → merge buffered append where seq > snapshot.latestSeq
  → 後續 append 依 seq/item transition 套用
  → reconnect: generation++，舊 read/stream 結果全部失效
```

訂閱必須先建立或 server 提供 resume cursor，否則 snapshot request 與 listener registration 中間會有 startup gap。若 IPC event bus 不能提供 replay cursor，最保守做法是「先訂閱並暫存，再抓 snapshot，最後依 seq merge」。

### 分階段導入

1. **先修 projection，不先改 Host protocol**：既有 Turn Record 已有 reasoning/message/tool/terminal 時，先讓執行進度由最新 active record row 推導；把 `Pi Core Host turn` 降為 fallback/metadata。
2. **補齊 lifecycle mapping**：逐一確認 Host 的 reasoning、assistant delta、tool start/result、retry、approval、interrupt、error、complete 都能落到同一 timeline item identity。
3. **補 terminal reconciliation**：completed item 覆核 live delta；cancel 必須等待 Host ack；所有 unfinished item 在 interrupt/error 時 settlement。
4. **補 race guards**：runId/turnId/itemId exact match、item transition guard、terminal-once、late event routing。
5. **補 reconnect/replay**：Host snapshot 重建 active turn；翻頁期間採 live-over-fetch merge 或等價 generation guard。
6. **最後才做 UI polish**：顯示 current activity、retry 倒數、interrupting、tool status 與 elapsed time；不新增假百分比。

## 驗收案例

- reasoning delta → tool running → tool completed → assistant delta → completed，live/replay 順序一致。
- transport 漏一段 assistant delta，completed full message 仍完整覆核。
- turn A 的 command late completion 在 turn B 開始後抵達，只更新 A。
- cancel 後 UI 先顯示 stopping，收到 terminal interrupted 才釋放 running；未完成 tool 不殘留 running。
- retryable stream error 顯示 retry，不提前標 failed；最後成功可正常完成。
- terminal failure 顯示 error，且不可再被 late success 改寫。
- reconnect 時 renderer 原本以為 idle，但 Host snapshot 為 active，能重建 timeline/current activity。
- 歷史 page fetch 回來比 live delta 晚，不可覆蓋 live text/tool state。
- replay/live 都收到 final message 時，以 `(turnId,itemId)` 去重。
