# 05 — Finalization claim retry、release 與 drain

**What to build:** finalization claim 或 stage 發生 transient failure 時，run 留在可恢復的 pending 狀態；完成與未完成不再混淆，capacity 也不會永久卡住或提早 drain 下一工作。

**Blocked by:** 04 — Execution terminal 與 finalization stage ledger

**Status:** 可交給代理

- [ ] claim unavailable、lease expiry、renderer replacement 與 Host CAS race 都保留 retryable pending-finalization
- [ ] Host finalization complete 前不送 complete ack；pending stage 可由 durable intent 安全續跑
- [ ] capacity release 不依賴 summary/UI 成功，但只在 execution 已 terminal 且 ownership 已安全交接後發生
- [ ] queue drain 只在 release receipt 後觸發，重試不會重複 dispatch 下一 run
- [ ] recovery projection 可查 execution、finalization、delivery 與 recovery action 四個欄位
