# 11 — qualification

Status: resolved
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

本 effort 的完整驗收收口。跑全套驗證並逐項記錄證據;任何一項 fail-closed 即 No-Go。

回歸案(spec 的 minimum regression cases,全部要有覆蓋):

- Host 已接受 run 但尚未 first record append 時重啟
- reasoning delta / tool 執行中 / 等待核准 / 取消中 重啟
- Host terminal append 之後、renderer finalization 之前重啟
- snapshot 與 live 重疊;重複與亂序事件抵達
- 較舊的 reconnect 回應在較新的 session／generation 之後才 resolve
- 保留有界缺口:renderer 回報缺口並從保留的 snapshot 復原
- 原 renderer finalizer 與重啟後 renderer 協調競跑
- 取消 ack 之後才抵達的 late provider success
- 同 thread 佇列後續維持順序;不同 thread 獨立執行
- 重複 attach 與 ack 不重複 transcript／metrics／artifacts／settlement

## Acceptance criteria

- [x] `npm run build`(typecheck)通過
- [x] 02 的 reattach 純模組 smoke 通過
- [x] 10 的真實重啟 e2e 通過,且連跑數次不 flaky
- [x] 延伸後的 `smoke-finalize-idempotency`、`smoke-run-completion-reachability`、`smoke-run-journal`、`smoke-run-journal-durability`、`smoke-run-lifecycle`、`smoke-live-timeline`、`smoke-steer-enqueue-fallback` 全綠
- [x] 完整 `npm run smoke` 鏈全綠
- [x] `npx oxlint` 對本 effort 觸碰的 renderer 檔案 0 warning
- [x] 上列回歸案逐項有覆蓋並記錄證據
- [x] 既有 drift guard 只加強未放寬(未新增 coordinator、未新增第二進度來源、main 無第二份 attachment truth；reattachment contract 由 protocol v3 引入，現由相容的 v4 承載)
- [x] 01 的決策記錄已回填 spec,Implementation Decisions 無殘留「未決」

## Blocked by

01–10（全部 resolved）

## Qualification evidence (2026-08-26)

- Current HEAD `3c99149` qualification: `npm run build` exit 0；完整 `npm run smoke` exit 0；本 effort 8 個 renderer source 檔案的 targeted `npx oxlint` 無輸出、exit 0。
- Targeted smokes：`smoke-reattach-reconcile`、`smoke-finalize-idempotency`（8 cases）、`smoke-run-completion-reachability`、`smoke-run-journal`、`smoke-run-journal-durability`、`smoke-run-lifecycle`、`smoke-live-timeline`、`smoke-steer-enqueue-fallback`（7 cases）全綠。
- 真實 restart：修正 startup/finalization deadlock 後曾連續四次執行 `node scripts/smoke-pi-electron-host-e2e.mjs`，每次皆為 `2 active + 2 terminal cases`；目前 HEAD 再跑 `npm run smoke:pi-electron-host-e2e` 亦為相同結果、exit 0。
- 回歸覆蓋：Host supervisor fixtures 覆蓋 first-append／approval／cancel／terminal retention；純 reconcile fixtures 覆蓋 overlap、duplicate、out-of-order、stale generation、gap、late-success；finalization fixtures 與 Electron launcher gate 覆蓋 original/replacement renderer CAS 競跑、terminal-before-finalize restart、重複 attach/ack；run lifecycle/journal smokes覆蓋同 thread ordering、不同 thread isolation 與 delivery semantics。
- `check:pi-contract`、production-owner/protocol/supervisor drift guards 全綠；Pi Core Host 仍是唯一 execution/attachment truth，`taskRunCoordinator.runTask` 仍是唯一 ingress/app finalization owner。
