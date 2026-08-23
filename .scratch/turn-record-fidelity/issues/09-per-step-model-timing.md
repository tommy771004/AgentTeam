# 09 — 每步的實測時間（TTFT 對 decoding）

**What to build:** 使用者能分辨「模型還沒開口」與「模型正在慢慢寫」：每個步驟記下 request 發出、第一個 token 抵達、產生完成三個時間點，於是等待首 token 與後續生成是兩段可讀的時間，而不是一個總數。進行中的工作只顯示起點，**不編造**時長。

**Blocked by:** 03

**Status:** done

- [x] 帳本的步驟條目記錄 request 開始、首 token、完成三個時間點，以及該步的 token 用量
- [x] 等待首 token 與生成時間可分別讀出
- [x] 進行中的條目只有起點、沒有時長；任何消費端不得為其合成 duration
- [x] 時間來自實測，不由前後條目相減猜測
- [x] Seam 1 smoke：腳本化一個「首 token 延遲明顯」的回合，斷言兩段時間可區分
- [x] Seam 2 smoke：進行中的 fixture 投影出的列不帶時長

## Comments

**Implemented and verified.**

`step-end` carries a `PiStepTiming` measured at the boundary that made the request: `requestAt`, `firstTokenAt` (absent when the request produced no text), `completedAt`, and the step's token usage summed from what the provider reported. `stepTimings(record)` reads it back as waiting / generating / total.

**Measured, never inferred.** A reader must not subtract one entry's timestamp from another's: entries are appended around work, not at its exact edges, and a turn can wait on tools between them. The smoke asserts that directly — a `step-end` with no `timing` reports no durations at all, even though its neighbouring entries are 4 seconds apart.

**A running step reports no duration.** Not zero, not a measurement against "now" — absent. Putting a number on screen that was never measured is the same class of mistake as publishing an answer nobody wrote.

The Host smoke scripts a model that thinks for 700ms and then writes quickly, and asserts the two halves come back distinguishable and in the right proportion: a slow first token must read as *waiting*, not as *writing*.

**One thing to know for ticket 10:** `firstTokenAt` is stamped on the first `text_delta`, so a step whose whole answer is thinking or tool calls has a total but no split. That is honest rather than a gap, and the trajectory view should render it as such.

Removed a dead `piTurnFinalAnswer` import in `piCoreRuntime`, unused since the truncation commit — oxlint flagged it once this file was in scope.
