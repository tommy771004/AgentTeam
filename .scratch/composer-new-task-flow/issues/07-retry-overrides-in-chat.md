# 07 — 調整參數重跑搬進對話

**What to build:** 任務失敗或中止後，使用者不必離開對話就能重跑：在既有的「下一步」動作區（目前放「繼續回合／繼續 Goal」的地方）多一個「調整參數重跑」，點開可以調最大迭代次數、最低信心門檻、逾時，然後直接重跑。重跑走既有的任務生命週期（新的 runId、來源記為 retry），結果照常回到同一個對話。三個後續動作在同一個區塊，一目了然。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 失敗／中止的 run 在「下一步」區出現「調整參數重跑」，成功的 run 不會出現
- [x] 可調整最大迭代、最低信心、逾時；只有這三個參數會被帶進重跑（白名單）
- [x] 重跑透過既有生命週期進行，產生新的 runId、來源標記為 retry，結果回到同一對話
- [x] 與「繼續回合／繼續 Goal」同區呈現，彼此不互相遮蔽
- [x] smoke（純邏輯）：retry 參數白名單
- [x] 元件測試：popover 參數輸入與送出的重跑請求內容

## Answer

新增 `agent/retryOverrides`（純）：`clampRetryParams` 夾緊三個參數（NaN 回退預設）、`retryEligibility` 對缺觸發證據的 Time/Proactive 誠實擋下（而不是偷改成 Goal-based 重跑）、`buildRetryOverrides` 白名單只放 maxIterations/minConfidence/timeoutMs 加必需的觸發證據。`RetryWithOverrides` popover 掛進 `RunContinuationActions`，只在 failed/halted 出現，與「繼續回合／繼續 Goal」同區；重跑走 `runTask`（新 runId、sourceKind=retry、reuseThreadId 回同一對話）。6 個元件測試 + 5 組 smoke。
