# 11 — qualification

Status: 可交給代理
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

- [ ] `npm run build`(typecheck)通過
- [ ] 02 的 reattach 純模組 smoke 通過
- [ ] 10 的真實重啟 e2e 通過,且連跑數次不 flaky
- [ ] 延伸後的 `smoke-finalize-idempotency`、`smoke-run-completion-reachability`、`smoke-run-journal`、`smoke-run-journal-durability`、`smoke-run-lifecycle`、`smoke-live-timeline`、`smoke-steer-enqueue-fallback` 全綠
- [ ] 完整 `npm run smoke` 鏈全綠
- [ ] `npx oxlint src` 對本 effort 觸碰的檔案 0 警告
- [ ] 上列回歸案逐項有覆蓋並記錄證據
- [ ] 既有 drift guard 只加強未放寬(未新增 coordinator、未新增第二進度來源、main 無第二份 attachment truth、Pi Host Protocol 為 v3)
- [ ] 01 的決策記錄已回填 spec,Implementation Decisions 無殘留「未決」

## Blocked by

01–10（全部 resolved）

## Current evidence (2026-08-26)

- Green: `npm run build`, `npx oxlint src`, full `npm run smoke`, `smoke-reattach-reconcile`, `smoke-live-timeline`, `smoke-run-journal`, `smoke-run-journal-durability`, `smoke-run-lifecycle`, `smoke-finalize-idempotency`, and the existing real Host protocol/session Electron smoke.
- Pending: ticket 10 true renderer restart e2e and repeated-run flake evidence; qualification remains No-Go until that proof lands.
