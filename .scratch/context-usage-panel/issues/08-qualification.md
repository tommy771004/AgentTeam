# 08 — qualification

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

本 effort 的完整驗收收口。跑全套驗證並逐項記錄證據；任何一項 fail-closed 即 No-Go。

## Acceptance criteria

- [ ] `npm run build`（typecheck）通過
- [ ] 新 context-projection smoke 通過
- [ ] conversation / run-operations / live-timeline / trajectory-paging 四支投影 smoke 通過
- [ ] run-lifecycle smoke 通過
- [ ] `npx oxlint src` 對本 effort 觸碰的檔案 0 警告
- [ ] 手動 UI 檢查：live run 的面板更新、running step 不猜數、比率/成本缺席時省略、external CLI 降級、`/cost` 輸出與面板一致
- [ ] 舊記錄回放：缺新 usage 欄位的封存對話投影與升級前逐欄一致

## Blocked by

01, 02, 03, 04, 05, 06, 07（全部 resolved）
