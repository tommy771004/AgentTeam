# 05 — renderer bootstrap 重新附著 + 容量重建

Status: 可交給代理
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

renderer 啟動時重新附著到仍在執行的 run,順序是**先訂閱、再取 snapshot、最後依 `seq` 合併**——反過來會在 snapshot 請求與 listener 註冊之間留下 startup gap(研究文件已指出)。

流程:訂閱並記下 generation → 緩衝期間收到的 append → 取 snapshot → generation 仍相同才安裝 → 用 02 的純模組合併 → 之後的 append 續用同一路徑。

同時必須用 Host active query 重建 renderer 的 run registry 投影並**重新佔用容量**。bootstrap reconciliation 完成前,新的 `runTask` admission 必須 fail closed／等待,不能在 renderer 容量尚未校準時放行。同 thread 是否已有 run 以 Host active identity 為準,不能只信剛重建的 Zustand。

`recordTotal` 改由 snapshot 的 `total` / `latestSeq` 校準取 monotonic max,不再用「本次 buffer 新增幾筆」累加。

**重新附著是觀察與協調,不是第二個 ingress**:不得呼叫 `dispatchThreadTask`、不得呼叫 `startExecution`、不得觸發第二次 model turn。

## Acceptance criteria

- [ ] 訂閱先於 snapshot;訂閱期間的 append 被緩衝且不遺失
- [ ] generation 不符時不安裝(較舊的回應不覆蓋較新的 session)
- [ ] 合併後的時間軸與從未斷線的投影逐列相同
- [ ] run 回到 run registry 且容量重新佔用;`maxConcurrentRuns` 在 reload 後仍生效
- [ ] bootstrap reconciliation 完成前 admission 不會利用暫時為零的 renderer registry 開新 run
- [ ] 同 thread 已有執行中 run 時,不會開出第二個 run
- [ ] `recordTotal` 取 monotonic max,backfill 不膨脹
- [ ] 全程未呼叫 `dispatchThreadTask` / `startExecution`、未觸發第二次 model turn(drift guard 斷言)
- [ ] 等待核准中的 run 重新附著後仍在等待,未被自動拒絕
- [ ] 不同 thread 在某 thread 重新附著期間仍獨立執行
- [ ] `npm run build` 通過

## Blocked by

02 — reattach 純協調模組 + smoke
04 — attach / ack 介面 + preload

## Implementation evidence (2026-08-26)

- `RecoveryBootstrap` subscribes to Host events before `runs.active()`, buffers record appends, attaches by sequence, restores Agent/thread registry identity, and gates admission fail-closed until reconciliation.
- `runActivityStore` merges by `seq` and calibrates `recordTotal` from Host `total/latestSeq`; `smoke-live-timeline.mts` covers overlap/backfill monotonicity and the reconnect/gap presentation.
- `npm run build`, `npx oxlint src`, and full `npm run smoke` passed. Real renderer-restart e2e remains ticket 10 and is not claimed here.
