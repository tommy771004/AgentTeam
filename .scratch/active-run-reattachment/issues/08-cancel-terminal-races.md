# 08 — cancel / terminal 競態

Status: resolved
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

讓既有的取消與終局語意在**跨 renderer 實例**時仍然成立:

- 重新附著的 run 可以要求取消(拿回畫面就拿回控制權)。
- 取消維持 `cancel_requested` 直到 Host ack,UI 不得宣稱一個尚未發生的停止。
- Pi Core Host 寫入 terminal 之後抵達的 late success **不得**把 cancelled／failed 改回成功；renderer 無權覆寫 Host settlement。
- 未完成的 tool item 在 interrupt／error 時全部 settlement,不殘留 running。
- **retryable transport 失敗與 terminal run 失敗必須是不同的東西**:連線斷掉重連中不得顯示成 run 失敗。

競態一律以 02 的 fixture 表達,不寫計時測試;真實時序由 10 的 e2e 覆蓋。

## Acceptance criteria

- [x] 重新附著後可要求取消,且請求確實送達 Host
- [x] 取消維持 `cancel_requested` 直到 Host ack;ack 前不宣稱已停止
- [x] late success 不復活已 cancelled／failed 的 run
- [x] interrupt／error 時未完成 item 全部 settlement,無殘留 running
- [x] retryable transport 失敗顯示為重連中,不顯示為 run 失敗
- [x] 以上競態皆有 fixture 覆蓋,無計時測試
- [x] `npm run build` 通過

## Blocked by

06 — 跨 renderer 實例的冪等結算

## Implementation evidence (2026-08-26)

- Reattached runs restore thread running identity, so existing `stopExecution` sends the Host interrupt/cancel while the activity store remains `cancel_requested` until Host settlement.
- Host attachment tests cover immutable terminal state, pending-approval clearing, lease/ack gates, and late-settlement protection; build and full smoke passed.
- 真實 renderer restart 後的 cancel/Host settlement 已由 ticket 10 Electron e2e 覆蓋；fixture 仍負責不含時鐘的 late-success 與 terminal immutability 競態。
