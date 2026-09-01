# Hermes skills authoring compatibility window

Status: time-bounded compatibility  
Decision date: 2026-09-01  
Removal deadline: before AgentStudio 1.3.0

## Decision

`app/src/agent/hermes/skills.ts` 暫不刪除。它仍是 Learning、Settings、slash、curator 與既有 personalization surfaces 的 authoring/read model；每次 mutation 由 `skillHostSync.ts` 將完整狀態寫入 Host-owned directory。Pi resource loader 仍是唯一 runtime discovery authority，renderer 不可把此 store 注入 Pi turn。

原紀錄稱它為「READ-ONLY rollback」並不正確。實際共有 12 個直接 consumers，其中包含 save、pin、archive、matching 與 bootstrap sync。若在 1.2.0 直接刪除，會讓使用者失去 skill authoring／管理功能。因此期限明確延長一個 minor release，並由 `check-pi-contract.mts` 以完整 import pattern 凍結 consumer set。

## Frozen consumers

- `src/App.tsx`
- `src/store/learningStore.ts`
- `src/pages/SettingsPage.tsx`
- `src/hooks/useSlashExecutor.ts`
- `src/agent/capabilities/runtime.ts`
- `src/agent/intentPreload.ts`
- `src/agent/hermes/curator.ts`
- `src/agent/hermes/learning.ts`
- `src/agent/hermes/plugins.ts`
- `src/agent/hermes/promptBuilder.ts`
- `src/agent/hermes/sessionSearch.ts`
- `src/agent/hermes/skillHostSync.ts`

## Exit criteria before 1.3.0

1. Host protocol 提供 list/read/save/remove/pin/archive/restore 的 user-skill authoring surface，並保留原有 validation、atomic write 與 diagnostics。
2. Learning／Settings／slash／curator consumers 全部改讀 Host projection，不再讀 localStorage `SkillsStore`。
3. 一次性 migration report 已完成，且新版本不再需要 renderer full-state `resources/sync-skills`。
4. 刪除 `skills.ts`、`skillHostSync.ts`、`SkillsMigrationBootstrap` 與 storage keys；更新 Guard 3 為 removed-file guard。
5. Build、skill Host sync/migration、Pi Host skills、slash 與 Learning qualification 全綠。

到達 1.3.0 前若 exit criteria 尚未完成，build 會 fail。再次延長必須修改 guard 與本文件，不能只調版本常數。
