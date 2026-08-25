# 01 — Turn Record 新增 reasoning entry，Host 寫入 thinking delta

Status: 已完成
Spec: `.scratch/unified-run-timeline/spec.md`

## What to build

模型的思考成為 Turn Record 的一級記錄。Host 在 turn pipeline 收到 message update 的 thinking delta 時（該事件流已存在，活動層已映射），與 tool-call、assistant-text 一樣依序寫入 `reasoning` entry：帶 turn 與 step 歸屬、seq 全序單調。**完整保留不截斷**——無 per-entry 截斷、無單 turn 總量上限（已批准的取捨，體積由既有 bounded paging 服務）。

**Blocked by:** None — can start immediately

## Acceptance criteria

- [x] Turn Record schema 新增 `reasoning` entry kind（source 為 model、content、turn、step）
- [x] Host 寫入點把 thinking delta 依到達順序 append；seq 單調、step 歸屬與同 step 的 tool-call 一致
- [x] 完整保留：無任何截斷路徑（明確決策，不得「順手」加 limit）
- [x] Turn record completeness smoke 延伸：thinking delta 進記錄、順序正確、無截斷
- [x] 既有 turn record／step timing smokes 維持綠
- [x] 不引入對 legacy loop seam 的新參照（ADR-0045 drift guard 維持綠）

## Implementation notes

- Schema：`src/agent/turnRecord.ts` 的 `reasoning` entry（`source: 'model'`）＋`KINDS`／`isEntry` content 檢查。
- 寫入點：`electron/piHostProtocol.ts` 的 recorder 多了 `reasoning: string[]` 緩衝；`recordReasoningDelta` 收 delta，`flushReasoning` 在三個有序邊界（message_end、tool_execution_start、step-end）整段寫成一則 entry——推理因此落在它所解釋的動作**之前**。
- 「一個 step 是一次 orchestration iteration，不是一次 model request」——Pi 在單一 turn 內跑自己的 tool loop，所以工具前後兩次請求共用同一 step。這是實測後修正的假設（先觀察再斷言），seq 才是順序的唯一依據。
- 驗證用新的 `scripts/smoke-pi-reasoning-record.mts`（真 Host＋真 provider 串流 `reasoning_content`），而非延伸 completeness smoke：後者刻意跑 `thinkingLevel: 'off'`，維持它「沒有推理的記錄不受影響」的迴歸角色。
