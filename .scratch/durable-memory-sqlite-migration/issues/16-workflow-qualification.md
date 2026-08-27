# 16 — 全 workflow qualification 與 tracker 收口

Status: 可交給代理
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

以真 Host、真 protocol 與現有 UI Projection 跑完 durable-memory 端到端 lifecycle，證明 Settings policy、run admission、recall、tool/automatic write、commit、revision、Learning UI、Dream、export/import、restart/recovery 與 cleanup 同屬一條一致 workflow。留下可重跑 gate evidence 後才可將 effort 標成 resolved。

## Acceptance criteria

- [ ] qualification scenario 從 policy/admission → scoped recall → tool/automatic settlement → commit → revision → UI refetch → consolidation → export/import → restart/recovery 全程可對帳
- [ ] temporary、disabled、write-disabled、other-project、cancelled/failed/non-DoD、External CLI 等 negative paths 都證明無漏讀／漏寫
- [ ] profile/document、相同 logical key 跨 project、Traditional Chinese/Unicode、pagination、quota 與 retry 端到端通過
- [ ] migration、corruption/degraded、downgrade、immediate-kill、disk/lock/concurrency 與 hard-delete evidence 可由主 gate 一 hop 查核
- [ ] Pi Host protocol negotiation、shared types、supervisor/main/preload/renderer consumers 版本一致，無 legacy response 假相容
- [ ] graph + source audit 證明 production 只有一個 durable-memory mutation authority，JSON memories 與 renderer sync 無 inbound owner
- [ ] `npm run build`、`npx oxlint src`、完整 `npm run smoke` 全綠，所有新增 deterministic smokes 已掛主鏈
- [ ] spec Tickets 表、tracker frontier、ticket acceptance checkboxes、Comments evidence 與 DEV_STATE 依 tracker resolved 規則完成對帳

## Blocked by

15 — Contract 舊 JSON 與 renderer memory owners
