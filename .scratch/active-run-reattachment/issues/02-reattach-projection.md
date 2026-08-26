# 02 — reattach 純協調模組 + smoke

Status: 可交給代理
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

本 effort 的**核心新測試接縫**。01 已決定真相在 Pi Core Host；本模組只協調 Host snapshot 與 live event，不自行判定或改寫 execution settlement。

一個純模組,把 snapshot 與 live 事件協調成一份狀態:

輸入:snapshot(entries、`latestSeq`、`total`、run 狀態)、訂閱期間緩衝的 entries、generation、已觀察的 high-watermark。
輸出:協調後的 entries(依 `seq` 排序去重)、新的 high-watermark(單調)、缺口回報、是否過期(generation 不符)、以及是否觀察到可交給既有 app finalization 出口的 Host terminal outcome。terminal 的種類由 Host snapshot／event 給定,renderer 不重新推導。

合約與 `liveTimeline` / `conversationProjection` / `projectContextUsage` 同族同純度:no I/O、no store、no clock、no randomness。排序只看 `seq`,**沿用 Turn Record 既有 sequence,不發明第二套事件詞彙**。

新 smoke 以 fixture 直餵(no Electron、no store、no DOM),掛進 `smoke` 鏈,並比照既有投影 smoke 加上原始碼禁用斷言作為純度 drift guard。

## Acceptance criteria

- [ ] 純度合約:原始碼禁用 `Date.now` / `Math.random` / zustand / 動態 import / `window.`,以 smoke 斷言
- [ ] snapshot 與 buffered 事件重疊時依 `seq` 去重,不重複列
- [ ] 亂序抵達的事件依 `seq` 排序,不依抵達順序
- [ ] generation 不符的輸入判為過期,不產生新狀態
- [ ] high-watermark 單調:backfill 的舊 `seq` 不推進 watermark、不膨脹 total
- [ ] 缺口以明確欄位回報(不是靠呼叫端自行相減)
- [ ] terminal 判定冪等:同一 terminal 事件重複輸入仍只得到一次結算決策
- [ ] late success 不得把已 cancelled／failed 的決策改回成功
- [ ] 同輸入同輸出(純度以 deepEqual 斷言)
- [ ] 新 smoke 掛進 `smoke` 鏈;`npm run build` 與 `npx oxlint src` 通過

## Blocked by

無（01 已 resolved；本票只依賴已定稿的 Host snapshot 合約）

## Implementation evidence (2026-08-26)

- `app/src/agent/reattachReconcile.ts` remains a pure snapshot/buffer/generation seam; `smoke-reattach-reconcile.mts` covers overlap dedupe, ordering, stale generation, bounded gaps, monotonic high-watermark, terminal immutability, and deterministic output.
- `npm run build` and the full `npm run smoke` chain passed after the renderer/Host integration.
