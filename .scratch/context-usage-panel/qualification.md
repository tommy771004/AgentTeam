# Context Usage Panel qualification

Status: resolved  
Qualified at: 2026-09-01

## Automated evidence

- `npm run build` — pass（TypeScript 與 production Vite build）。
- `node --experimental-strip-types scripts/smoke-context-usage-projection.mts` — pass；同時涵蓋 `/cost` 與面板共用投影格式。
- `node --experimental-strip-types scripts/smoke-conversation-projection.mts` — pass。
- `node --experimental-strip-types scripts/smoke-run-operations-projection.mts` — pass。
- `node --experimental-strip-types scripts/smoke-live-timeline.mts` — pass。
- `node --experimental-strip-types scripts/smoke-trajectory-paging.mts` — pass。
- `node --experimental-strip-types scripts/smoke-run-lifecycle.mts` — pass。
- `npx oxlint`（本 effort 的 source 與 qualification fixture）— 0 warning。
- `npm run smoke:context-usage-ui` — pass；此 gate 也透過 `presmoke` 接入完整 smoke。

## Rendered UI evidence

`qualify-context-usage-ui-e2e.mts` 掛載 production `ContextUsagePanel`，輸入由 production `appendTurnRecord`／`parseTurnRecord`／`projectContextUsage` 產生：

- running step 僅顯示已結算的 4,200 tokens，沒有預估第二步；
- step 結算後 live 更新為 10,500 tokens、US$0.03 與 6%；
- pricing 或 context window 未知時省略對應成本／比率；
- external CLI 只呈現 8,500-token scalar 與降級說明，不捏造 input/cache/cost；
- 缺少新增 usage 欄位的 v1 legacy record 可回放，cache/cost 如實顯示為未回報；
- 320px viewport 無水平 overflow。

一般 Vite preview 另確認頁面可載入；因 browser preview 不具 Electron preload API，live Host 行為由上述真實元件 fixture 驗證，而不是將 API 缺席誤判成產品失敗。
