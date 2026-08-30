# 07 — Browser-tab-like WorkspacePanelSession

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

把右側 `InlineRunPanel`／terminal aside 深化為 browser-tab-like `WorkspacePanelSession` UI Projection，支援執行摘要、審查、驗證、終端機 target 的 open/focus/reuse/close、dock、resize、maximize 與 restore。只持 presentation state，不擁有 run、PTY、artifact 或 Git lifecycle。

## Acceptance criteria

- [x] stable tab identity；從同一 summary 重開 review 只 focus，不重複建立
- [x] close tab 不 stop run、不 kill PTY、不 delete artifact；終止動作獨立且明確
- [x] app reload 恢復 layout/active tab/selection；missing target 顯示 recovery state
- [x] keyboard tab semantics、focus return、close shortcut、ARIA 與 visible focus 完整
- [x] 360px summary、420–960px review resize 與 narrow full-screen 行為實際驗證

## Completion evidence

- `WorkspacePanelSession` 與 zustand presentation store 已涵蓋 stable open/focus/reuse/close、dock、resize、maximize、restore；持久化資料不含 run、PTY、artifact 或 Git lifecycle。
- `npm run smoke:workspace-panel-session`：通過（identity、width clamp、restore、focus fallback、ARIA／keyboard／responsive source guards）。
- `npx tsc -p tsconfig.app.json --noEmit`：通過。
- `npx oxlint src/store/workspacePanelSessionStore.ts src/components/WorkspacePanelSession.tsx src/pages/ProtocolsPage.tsx scripts/smoke-workspace-panel-session.mts`：通過。

## Blocked by

01 — Review target 與 attribution contract
