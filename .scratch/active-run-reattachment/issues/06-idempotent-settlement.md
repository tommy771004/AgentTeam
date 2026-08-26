# 06 — 跨 renderer 實例的冪等結算

Status: 可交給代理
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

Pi Core Host 先把不可逆的 execution settlement 寫進 attachment journal；renderer 重新附著後,只把該 Host terminal outcome 交回 `taskRunCoordinator` **既有的 unique app finalization**(summary → afterRun → Archive → onSettled → release → drain),冪等地跑一次——不論中間 renderer 重啟過幾次,也不論原 renderer 的 finalizer 與重啟後 renderer 的協調是否競跑。renderer 不重新判定 success／failed／cancelled。

結算完成後送出 acknowledgement,釋放 03 的保留。ack 本身要冪等。

既有的 `smoke-finalize-idempotency` 延伸涵蓋新的競跑案;`smoke-run-completion-reachability` 延伸涵蓋「Host terminal append 之後、finalization 之前重啟,結果仍到得了使用者」。

**不得新增第二個 coordinator。** 若實作過程發現結算歸屬必須移動,先寫 ADR 再動工。

## Acceptance criteria

- [ ] 一個 run 恰好結算一次:摘要氣泡、metrics、Archive、artifacts 皆不重複
- [ ] Pi execution settlement 只由 Host 決定且 terminal 不可逆；app finalization 只消費該 outcome
- [ ] 原 renderer finalizer 與重啟後 renderer 協調競跑時仍只結算一次
- [ ] renderer 在 Host terminal append 之後、finalization 之前重啟,結果仍到得了使用者
- [ ] 結算後送出 ack 並釋放保留;重複 ack 無副作用
- [ ] 重複 attach 不產生重複 transcript／metrics／artifacts／settlement
- [ ] 未新增第二個 coordinator(既有 drift guard 全綠)
- [ ] `smoke-finalize-idempotency`、`smoke-run-completion-reachability`、`smoke-run-lifecycle` 延伸後全綠

## Blocked by

05 — renderer bootstrap 重新附著 + 容量重建

## Implementation evidence (2026-08-26)

- Pi terminal app finalization now claims the Host CAS (`runs.finalizeClaim`) before the existing `finalizeTaskRun` sequence, completes the claim before `runs.ack`, and uses the same path for recovered terminal attachments.
- `smoke-finalize-idempotency.mts` covers original CAS ordering and a losing renderer performing no app effects/ack; `smoke-pi-host-supervisor.mts` covers lease takeover and idempotent complete/ack.
- Cross-process true renderer restart remains dependent on ticket 10; no duplicate-proof claim is made until that e2e runs.
