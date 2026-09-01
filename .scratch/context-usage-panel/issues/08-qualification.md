# 08 — qualification

Status: resolved
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

本 effort 的完整驗收收口。跑全套驗證並逐項記錄證據；任何一項 fail-closed 即 No-Go。

## Acceptance criteria

- [x] `npm run build`（typecheck）通過
- [x] 新 context-projection smoke 通過
- [x] conversation / run-operations / live-timeline / trajectory-paging 四支投影 smoke 通過
- [x] run-lifecycle smoke 通過
- [x] `npx oxlint src` 對本 effort 觸碰的檔案 0 警告
- [x] UI qualification：live run 的面板更新、running step 不猜數、比率/成本缺席時省略、external CLI 降級、`/cost` 輸出與面板一致
- [x] 舊記錄回放：缺新 usage 欄位的封存對話仍可 parse，量測欄位如實省略且其餘投影一致

## Blocked by

01, 02, 03, 04, 05, 06, 07（全部 resolved）

## Evidence

2026-09-01 的完整命令與結果記錄於 `../qualification.md`。UI 項目使用 production `ContextUsagePanel` 與真實 Turn Record 投影的 rendered fixture 驗證，不以靜態仿製畫面代替。
