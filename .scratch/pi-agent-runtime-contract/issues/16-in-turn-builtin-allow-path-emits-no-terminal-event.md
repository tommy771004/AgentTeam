# 16 — 被允許的 in-turn builtin 沒有終局事件

**What to build:** 一個 model-originated builtin tool call，不論被允許還是被拒絕，都在 Host event stream 上留下同一組可觀察的生命週期（start → decision → 終局 result），使 UI、session `toolAudit` 與 Turn Record 對「這個呼叫怎麼結束」給出一致的答案。目前只有被拒絕的呼叫有終局事件。

**Blocked by:** 無。

**Status:** 可交給代理

## 問題

`electron/piHostProtocol.ts:2345` 的 turn audit sink：

```ts
send(event)                      // host/tool-decision，永遠發
if (record.decision !== 'allow') {
  send(resultEvent)              // host/tool-result，只在非 allow 時發
}
```

於是一個**被允許**的 in-turn builtin 呼叫只發出 `host/tool-decision`，沒有 `host/tool-start`，也沒有任何終局 `host/tool-result`。被拒絕的呼叫則有 decision + result。

Turn Record 不受影響：`piHostProtocol.ts:1937` 在 `tool_execution_end` 寫入 `kind: 'tool-result'`，所以持久記錄是完整的。缺的是**事件流**，以及跟著事件流走的 `session.toolAudit`（`recordToolAudit` 只看得到這裡 send 出去的東西）。

這不是 issue 13 造成的，而是 issue 13 讓它第一次被看見：在 macOS 有 verified sandbox 之前，`required` 的 builtin shell 永遠被拒絕，於是永遠走在有終局事件的那條路上。

## 為什麼要修

- **UI 收到一個永遠不會結束的呼叫。** 有 decision、沒有 terminal，前端無法把它從「執行中」移出去。
- **同一個工具，兩種來源，兩種形狀。** 直接協議呼叫（`tools/bash` 等，`piHostProtocol.ts:566-640`）會發 start → decision → result；同一個工具由模型在 turn 內呼叫則不會。這與 issue 15「所有 invocation origins 描述同一個 per-turn contract」直接衝突。
- **per-session 稽核不對稱。** 被拒的呼叫在 `toolAudit` 有 start/decision/result 三個 phase，被允許的只有 decision —— 稽核紀錄因此無法回答「這個被允許的呼叫做完了嗎」。

## 驗收條件

- [x] 被允許的 model-originated builtin 呼叫發出恰好一個終局 `host/tool-result`，settlement 為 `success` / `failed` / `cancelled`。
- [x] 終局事件恰好一次：既有的 denial 路徑已經自己發過 terminal，`tool_execution_end` 不得再補一個（`consumePiDeniedInTurnCall` 現有的去重語意必須保留）。
- [x] 事件攜帶與 `tool-call` 相同的 contract identity（`contractRevision`、`contractDigest`、`schemaDigest`、`toolSource`、`invocationOrigin`）。
- [x] `host/tool-start` 對 in-turn builtin 的取捨被明確決定並記錄：補上，或說明為何 in-turn 的 start 由 decision 承擔。
- [x] 釐清 in-turn builtin 是否應發 `host/tool-update`（streaming）；若否，寫下理由，因為直接協議路徑會發。
- [x] `session.toolAudit` 對被允許與被拒絕的呼叫呈現同一組 phase。
- [x] Qualification 以真實 Pi turn 同時覆蓋 allow 與 deny 兩條路徑，並斷言終局事件恰好一個。
- [x] `scripts/smoke-pi-adr0047-real-turn-denial.mts` 中釘住此缺口的 `assert.equal(eventResults.length, 0, ...)` 連同其註解一併更新為正確的期望值。

## Comments

- 缺口是在 issue 13 的 macOS Seatbelt tracer 落地時發現的：`required` 在 darwin 首次走到 allow 路徑，才暴露出該路徑沒有終局事件。
- 開票時該行為以 `assert.equal(eventResults.length, 0)` 釘在 `smoke-pi-adr0047-real-turn-denial.mts`，好讓修好的當下那條斷言會失敗、被刻意更新而不是無聲改變。它確實如此失敗了，並已更新（見下）。

- 修法：`piHostProtocol` 新增 `publishInTurnToolEvent()`，在 Pi 的 `tool_execution_start` 發 `host/tool-start`、在 `tool_execution_end` 且**非** denial 時發 `host/tool-result`，兩者都帶 contract identity 並經 `recordToolAudit` 進入 session 稽核。
- `host/tool-start` 決定**補上**：這樣 in-turn 與 direct-protocol 兩種來源的事件形狀一致，issue 15 的「所有 origins 描述同一個 contract」才成立。
- 實作過程踩到一次真的雙寫：`recordToolAudit` 在 result phase 本來就會寫一筆 Turn Record `tool-result`，我另外又寫了一筆，導致一個 call 有兩個 terminal。已改為 **`recordToolAudit` 是 Turn Record terminal 的唯一寫入者**，`smoke-pi-adr0047-real-turn-denial` 的「one terminal result」斷言當場抓到這件事。
- Streaming（`host/tool-update`）**維持不發**：in-turn 的增量輸出已經以 `host/turn-item` 串流，再發一份會讓同一份輸出出現兩次。direct-protocol 路徑發 `host/tool-update` 是因為它沒有 turn-item 串流。
- 釘住此缺口的 `assert.equal(eventResults.length, 0, ...)` 已如票中所要求更新為 `=== 1`，並加驗 settlement、invocationOrigin 與 `host/tool-start` 恰好一次。
