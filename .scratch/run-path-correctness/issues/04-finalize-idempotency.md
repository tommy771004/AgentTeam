# 04 — Finalization 冪等宣告與容量釋放保證

Status: 可交給代理
Spec: `.scratch/run-path-correctness/spec.md`

## What to build

Finalization 目前可能在外層 catch 中被從頭二次執行：重複失敗氣泡、journal terminal 記錄寫兩次、onSettled（scheduler/webhook 結算）觸發兩次。本票引入 per-run 冪等宣告（模式仿既有 capacity registry 的宣告集合）：finalization 入口先取得宣告，成功才執行序列，重複呼叫直接 no-op 返回首次結果；外層 catch 保留作最後防線但不再造成二次結算。容量釋放從「序列中的一步」提升為「無論序列成敗皆由冪等持有者保證執行」的義務（try/finally 包裹整段序列）。早終路徑與正常路徑共用同一宣告機制。

注意：本票與票 01 都修改 task run coordinator，但區域不同（本票只動 finalization 序列與其外層 catch）；合併時後到者 rebase 即可，無邏輯相依。

**Blocked by:** None — can start immediately

## Acceptance criteria

- [ ] Finalization 取得 per-run 冪等宣告；同一 run 第二次呼叫為 no-op 且返回首次結果
- [ ] Finalization 序列中途拋錯後再觸發，journal terminal 記錄、thread 終態氣泡、封存、onSettled 各恰一次
- [ ] 容量槽在任何 finalization 結局（成功、拋錯、no-op 重入）下都恰釋放一次
- [ ] 早終（early finalization）路徑與正常路徑共用宣告機制，早終的雙重 setThreadRunning 冗餘一併收斂
- [ ] Smoke 於 coordinator admission 接縫驗證冪等性：令序列在中途拋錯，斷言副作用各恰一次
- [ ] Queue drain 語意不變（dedupe key、FIFO、上限皆不受影響）
