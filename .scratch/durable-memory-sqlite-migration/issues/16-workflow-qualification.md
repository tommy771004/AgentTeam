# 16 — 全 workflow qualification 與 tracker 收口

Status: resolved
Spec: `.scratch/durable-memory-sqlite-migration/spec.md`

## What to build

以真 Host、真 protocol 與現有 UI Projection 跑完 durable-memory 端到端 lifecycle，證明 Settings policy、run admission、recall、tool/automatic write、commit、revision、Learning UI、Dream、export/import、restart/recovery 與 cleanup 同屬一條一致 workflow。留下可重跑 gate evidence 後才可將 effort 標成 resolved。

## Acceptance criteria

- [x] qualification scenario 從 policy/admission → scoped recall → tool/automatic settlement → commit → revision → UI refetch → consolidation → export/import → restart/recovery 全程可對帳
- [x] temporary、disabled、write-disabled、other-project、cancelled/failed/non-DoD、External CLI 等 negative paths 都證明無漏讀／漏寫
- [x] profile/document、相同 logical key 跨 project、Traditional Chinese/Unicode、pagination、quota 與 retry 端到端通過
- [x] migration、corruption/degraded、downgrade、immediate-kill、disk/lock/concurrency 與 hard-delete evidence 可由主 gate 一 hop 查核
- [x] Pi Host protocol negotiation、shared types、supervisor/main/preload/renderer consumers 版本一致，無 legacy response 假相容
- [x] graph + source audit 證明 production 只有一個 durable-memory mutation authority，JSON memories 與 renderer sync 無 inbound owner
- [x] `npm run build`、`npx oxlint src`、完整 `npm run smoke` 全綠，所有新增 deterministic smokes 已掛主鏈
- [x] spec Tickets 表、tracker frontier、ticket acceptance checkboxes、Comments evidence 與 DEV_STATE 依 tracker resolved 規則完成對帳

## Comments

- `smoke-durable-memory-workflow-qualification.mts` 是可執行的一 hop 證據索引：固定 16 個 owning smokes 在 `smoke:pi-parity-qualification` 的順序，並 source-audit protocol v5、schema 4、renderer projection 與單一 `DurableMemoryStore` authority。主 `npm run smoke` 必須到達該 chain。
- policy/admission、scope、Memory Pack tool write、explicit/automatic finalization、revision、UI invalidation/refetch、Dream、export/import、restart/recovery 分別由既有 shipped-module smokes持有；roll-up 不重做第二份 store。temporary／disabled／other-project／terminal outcome／External CLI 等負向矩陣同在該 chain。
- protocol v5 移除 whole-bundle memory methods/response；v2-v4 若呼叫已改 shape 的 `state/snapshot` 會 fail-closed `protocol_mismatch`。Supervisor 使用版本常數；Main/Preload/renderer 只暴露 paged `memoryProjection`。
- 本環境未提供 codebase-memory graph MCP；production inbound 以 `rg` literal/caller inventory、`check-pi-contract.mts` hard drift guard 與 qualification source audit 共同證明為 0。
- 驗證：`npm run build` 綠；`npx oxlint src` 0 errors（既有 warnings 保留）；`npm run smoke:pi-parity-qualification` 綠；完整 `npm run smoke` 在乾淨 HEAD worktree 全綠。共享工作樹的第一次完整 run 已通過所有 memory/runtime gates，最後只被另一組未提交 working-state complexity changes 擋住，因此沒有修改或納入該組變更。
- `$implement` 要求的兩軸 review 已執行：Standards finding（smoke 內重做 special-kind 規則）改為顯式 fixture；Spec findings（舊 snapshot client 未 fail-closed、subscription smoke 寫死 v4）均修正並以 targeted smokes 驗證。

## Blocked by

15 — Contract 舊 JSON 與 renderer memory owners
