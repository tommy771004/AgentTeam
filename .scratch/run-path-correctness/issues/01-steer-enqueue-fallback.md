# 01 — Steer 逾時入隊 fallback 與如實氣泡

Status: 可交給代理
Spec: `.scratch/run-path-correctness/spec.md`

## What to build

使用者在 run 忙碌時送出轉向（steer）訊息：若前一個 run 在等待窗口內無法停下來（安全停靠停在工具邊界是正常行為），新目標自動走既有的 external-run 佇列入隊路徑，回報佇列位置，不再以 busy 丟棄。Thread 上的系統氣泡依實際結果分流——「已轉向」（容量確實釋放、新目標接手）、「已中止前一任務，新目標已排入佇列第 N 位」、「無法中止前一任務」——中止前摘要（partial digest）在三種分支都保留。只有在前一個 run 根本不存在或無法中止時才允許回報 busy。

注意：本票與票 04 都修改 task run coordinator，但區域不同（本票只動 admission 的 steer 分支）；合併時後到者 rebase 即可，無邏輯相依。

**Blocked by:** None — can start immediately

## Acceptance criteria

- [ ] Steer 分支在固定輪詢窗口耗盡且容量未釋放時，改走既有佇列入隊機制（含 dedupe key），回傳 queued 結果與佇列位置，而非 `skipReason: 'busy'`
- [ ] 僅當無可中止的 busyRunId 時才回 busy
- [ ] 氣泡文案三分支如實分流；partial digest 三分支皆保留
- [ ] 自動化來源（schedule/webhook/telegram）的 steer 語意一致，不會靜默掉訊息
- [ ] Smoke 於 coordinator admission 接縫驗證：以可注入/模擬的 capacity 與 stop 行為重現「停不下來」情境，斷言結果為 queued、氣泡存在、objective 進入佇列
- [ ] CLAUDE.md Busy policy 段補上 steer 逾時入隊 fallback 語意
- [ ] 不引入任何對 legacy loop seam 的新參照（ADR-0045 drift guard 維持綠）
