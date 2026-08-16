# 01 — DoD verdict 型別與逐輪記錄

**What to build:** Goal-based Task run 的每一輪 DoD 語意驗收結果被結構化保存：loopRunner 在每次 `evaluateDoD` 後將判定（輪次、met、confidence、missing 清單、時間）append 進 run 狀態的 `dodVerdicts`，事後可讀——不再是只有自由文字 log。smoke 以 fixture 驗證 append 語義（每輪一筆、met/missing 快照不被後輪覆蓋）。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `dodVerdicts` 型別（iteration、met、confidence、missing[]、evaluatedAt）落於 run 狀態
- [x] loopRunner 每輪驗收後 append（含 LLM 關閉時的降級行為：不 append 或明確標記未驗證）
- [x] smoke：append 真值（輪次遞增、快照不互相覆蓋、final verdict = 最後一筆）

## Answer

`DodVerdict` 型別（iteration/met/semantic/confidence/missing/evaluatedAt）落於 `types.ts` 的 `AgentState.dodVerdicts?`；純函數模組 `src/agent/dodVerdicts.ts`（`appendDodVerdict` 快照隔離、`finalDodVerdict`、`dodConvergence` 收斂歷程）。loopRunner 每輪 DoD 檢查後 append——語意驗收輪 `semantic=true`，啟發式/例外回退輪 `semantic=false`（未驗證是明確狀態，不是缺資料）。smoke `smoke-run-reports.mts`（append 真值＋loopRunner 接線 drift guard）。驗證：smoke 2 groups、`tsc -b` 綠、smoke-loop-runner 11 passed 回歸、元件測試 93 passed。
