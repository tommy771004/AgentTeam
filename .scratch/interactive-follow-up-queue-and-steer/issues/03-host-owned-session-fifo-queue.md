# 03 — Host-owned 同 Pi Session FIFO Queue

Spec: `../spec.md`

**What to build:** 讓使用者在 active Task run 期間把後續指令排入 Pi Host 權威的同 Pi Session queue。項目在接受時凍結執行所需意圖、附件引用與 run-scoped 行為；只有目前 Task run 完成 unique finalization 並寫入 terminal settlement 後，Host 才按 FIFO 釋放第一筆重新進入 `runTask`。Composer 投影真實 queue position、queue-full、dispatching 與內容摘要，不以 renderer localStorage 宣稱接受成功。

**Blocked by:** 01 — Follow-up 動作契約與「中止並接手」語意展開.

**Status:** 可交給代理

- [ ] Active Builtin Pi session 可經公開 follow-up submission 接受多筆 Host-owned queued items，並回傳穩定 identity、position 與 queue revision
- [ ] Queue item 凍結 objective、附件 reference、runner kind、action 與必要 run-scoped settings；renderer 只能取得安全 metadata projection
- [ ] Model response、tool result、loop iteration、provisional DoD 或 capacity event 都不會釋放 same-session queue
- [ ] Active Task run 完成既有 finalization 與 terminal settlement 後，只釋放 FIFO 第一筆並恰好一次重新進入 `runTask`
- [ ] 下一筆須等前一個 queued Task run terminal settlement 才可 admission；同一 Pi Session 永不重疊兩個 Task runs
- [ ] 不同 conversations 在 `maxConcurrentRuns` 內仍可獨立並行，不被單一 session queue 全域序列化
- [ ] Queue full 回傳明確失敗且不驅逐、覆寫或重新排序既有 accepted items，未接受文字仍可恢復
- [ ] Composer queue card 顯示實際摘要、動作、position 與 queued／dispatching 狀態，Host acknowledgement 前不宣稱已排隊
- [ ] 真 Host／coordinator smoke 覆蓋三筆 FIFO、所有非 terminal 邊界、跨 session concurrency、queue full 與單一 ingress，並掛入 smoke gate

