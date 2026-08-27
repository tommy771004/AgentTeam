# 02 — Execution evidence 驗證 goal completion

**What to build:** 讓一個檔案變更 goal 只有在 Host 實際執行工具、取得正確 Execution evidence 並通過 goal-specific Checker 後才變成 done。模型或工具參數提出的是 State Proposal，不是完成憑證。

**Blocked by:** 01 — 單一 goal 的 Host-owned Working State vertical slice

**Status:** resolved

- [x] 一個 builtin 檔案變更 run 能從 pending goal 經 tool call、trusted Host result、State Proposal、State Check 到 committed done state 完整走通。
- [x] Checker 同時驗證 run、goal、tool、call 與 evidence identity；錯綁、缺漏、malformed 或 model-attested evidence 一律 fail closed。
- [x] Assistant completion text、tool arguments、exit code 0 或單純 successful settlement 都不能自行完成 goal。
- [x] denied、failed、cancelled、interrupted 與 not-executed tool outcome 保持 goal 未完成，並留下可稽核 verdict。
- [x] Turn Record 依序呈現 proposal、tool evidence、state check 與下一個 committed Working State，且 source accountability 正確。
- [x] 最終 Definition of Done 由 committed goal state 與 Checker verdict 決定，不再以非空 assistant output 作為自訂 DoD 成功 fallback。
- [x] 真實 Host lifecycle smoke 覆蓋成功與 false-done refusal，並已加入實際 smoke gate。
