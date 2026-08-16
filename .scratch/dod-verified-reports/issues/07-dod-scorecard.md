# 07 — DoD Scorecard 元件

**What to build:** run 摘要卡內嵌的 DoD 計分卡：各 DoD 缺口項目的通過／未驗證狀態、迭代收斂歷程（每輪後剩餘 gaps）、證據連結（對應工具呼叫/輸出摘錄）；「已驗證完成」與「執行完畢（未驗證）」為兩種明確視覺狀態；無 verdict（外部 CLI run）顯示誠實標示而非空白。

**Blocked by:** 02

**Status:** resolved

- [x] 計分卡渲染逐項狀態與收斂歷程
- [x]「已驗證完成」vs「執行完畢（未驗證）」兩狀態
- [x] 無 verdict（CLI run）顯示誠實標章
- [x] 元件測試：三種形態（全過、有缺口、無 verdict）

## Answer

`src/components/DodScorecard.tsx`：最終輪 semantic+met → 綠色「DoD 已驗證完成」＋輪數＋收斂歷程（第 N 輪剩 X → …）；met 但啟發式 →「執行完畢（未驗證）」；未達 → 缺口數＋清單（前 6 項）；外部 CLI run 無判定 → 引用 `EXTERNAL_CLI_DOD_LABEL` 誠實標章；builtin 無判定不渲染。嵌入 RunSummaryCard（標頭與 subDesign 條之間）。為此補 `runnerKind` 傳導（ThreadRunSummary＋coordinator pushRunSummary 以 dispatch path 判定）。元件測試 5 案。
