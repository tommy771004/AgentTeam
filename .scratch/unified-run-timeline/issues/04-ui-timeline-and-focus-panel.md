# 04 — UI 單一時間軸與右側推理聚焦模式

Status: 已完成
Spec: `.scratch/unified-run-timeline/spec.md`

## What to build

執行中呈現單一時間軸：思考（收合列）→ 工具呼叫 → 結果 → 回應交錯，assistant 的進行中草稿屬於時間軸的當前 assistant 列——使用者不必再於三個面板間對照。右側「推理摘要」面板改聚焦模式：自動捲動跟隨當前 step 的推理；使用者手動捲動即暫停跟隨，並可一键回到當前。執行訊息清單與時間軸收斂，不再重複呈現同一內容。

**Blocked by:** 03 — live feed record projection

## Acceptance criteria

- [x] 單一時間軸呈現思考→工具→結果→回應交錯；草稿文字屬於當前 assistant 列
- [x] 右側推理面板自動捲動聚焦當前 step；手動捲動暫停跟隨、可回當前
- [x] 執行訊息與時間軸收斂為同一投影來源，無重複呈現
- [x] 事後（重啟後）軌跡與 live 呈現同構——同一投影
- [x] Plain-browser 降級環境（無 Host）行為不變
- [x] UI copy 沿用繁中混英慣例；狀態與標籤人類可讀

## Implementation notes

- `RunProcessFeed.tsx`：有 record 就渲染單一「執行時間軸」，同時關掉推理摘要 disclosure、執行訊息群組與底部串流草稿——三處都以 `!hasRecordTimeline` 明確擋住，drift guard 盯著。
- 草稿去重在 store：一旦 `assistant-text` 進了 record，`appendRecordEntries` 就清掉 draft。否則同一句會同時以「已記錄的 assistant 列」與「還在寫的草稿列」出現兩次。
- `ReasoningFocusPanel.tsx`：分段呈現（一則思考一塊）、自動跟隨最新、手動捲動即停、「回到目前」恢復；沒有 record 的 runner 退回原本的聚合 `thought`。
- Plain-browser／external CLI：沒有 Host 事件就沒有 record entries，`hasRecordTimeline` 為 false，現行呈現一行未改。
- **已知落差（既有，非本次造成）**：事後軌跡的 owner `TrajectoryPanel` 目前沒有任何畫面掛載它。本次讓它正確呈現 reasoning（列上顯示字數、選取後讀全文），但「重啟後查看每一步推理」要真的可達，需要另外決定它掛在哪一個畫面。
