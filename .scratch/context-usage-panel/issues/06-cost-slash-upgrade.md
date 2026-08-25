# 06 — /cost 升級

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

`/cost`（aliases `/tokens` `/usage`）改為輸出 03 投影的完整分解：總量、輸入、輸出、快取讀/寫、成本（有 pricing 時）、對 context window 的比率。取代現行的單一 `tokensUsed` scalar 輸出；步驟/工具數與耗時行保留。無記錄的 runner 退回現行 scalar 行為。

## Acceptance criteria

- [ ] `/cost` 輸出投影的分解數字，與面板一致（同一投影、零第二來源）
- [ ] 成本與比率在資料缺席時整行省略，不顯示 0 或佔位
- [ ] external CLI 路徑退回現行 scalar 輸出
- [ ] `npm run build` 通過

## Blocked by

03 — contextProjection 純投影 + smoke
