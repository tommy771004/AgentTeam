# 08 — Review explorer UI

Status: resolved
Spec: `.scratch/run-review-workspace/spec.md`

## What to build

建立審查 tab：scope/provenance toolbar、file navigator、搜尋/filter/sort、統計、unified/split、context folding、next/previous change、copy/open actions 與 lazy hunk viewer。沿用 AgentStudio tokens、Material Symbols 與密度，不複製 Codex proprietary assets。

## Acceptance criteria

- [x] run snapshot/live/staged/branch/snapshot range 來源與 freshness 一眼可辨
- [x] loading/empty/partial/stale/failed/missing/binary/unsupported 各有真實 action，無 dead controls
- [x] 大型 review 任意選檔、切換視圖與取消請求不失去目前位置
- [x] file/path/status/review filter 與 next/previous keyboard navigation 可操作
- [x] desktop/narrow、pointer/keyboard、contrast/focus/overflow/rendered visual QA 通過

## Completion evidence

- `WorkspaceReviewProjection` 已由 Pi Host protocol／supervisor／main／preload typed bridge 投影到 renderer；五種 target 皆經 `describeTarget`、`listFiles`、`readFileDiff`，React 不組 Git command。
- `ReviewExplorer` 已涵蓋 provenance/freshness、path/status/sort、server-side search、cursor file/hunk paging、unified/split、context folding、copy、refresh、Alt+↑/↓ 與 request cancellation。
- `npm run smoke:review-workspace-binding`：完整 focused chain 通過；包含 Host protocol → projection → explorer guards。
- `npm run build`、`npx tsc -b --pretty false`：通過。
- focused `oxlint`：0 errors；`electron/main.ts` 仍有 4 個既存 unused warning，非本票引入。
- Rendered QA：桌面與 390×844 窄版無水平 overflow／功能性裁切；Binary/partial state、Alt+↓ selection 與 Split pressed state 實際操作通過。

## Blocked by

05 — Diff scopes、file manifest 與 lazy paging; 07 — Browser-tab-like WorkspacePanelSession
