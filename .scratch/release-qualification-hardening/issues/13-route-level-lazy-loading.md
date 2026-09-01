# 13 — Route-level lazy loading

**What to build:** 讓低頻頁面離開 initial renderer bundle，在不延遲 primary conversation 與 startup authority bootstraps 的前提下，降低首次載入 JavaScript。

**Blocked by:** None — can start immediately.

**Status:** 已完成

- [x] 先以 production measurement 建立 initial chunk 與主要 route chunks baseline。
- [x] Settings、SubDesign、Learning 等低頻 routes 在首次進入時才載入，primary conversation 與必要 bootstraps 保持 eager。
- [x] Loading/error boundaries 在 desktop 與 narrow viewport 可用，鍵盤 focus 與 navigation continuity 不退化。
- [x] Production build 顯示 initial chunk 實質下降，route chunks 可辨識且沒有把共用大依賴複製多份。
- [x] Built Electron smoke 與 plain-browser degraded preview 都保持可啟動。

## Implementation evidence

- Production baseline initial renderer chunk: 1,277,330 bytes (377.64 kB gzip).
- Lazy-route build initial chunk: 1,023,372 bytes (314.11 kB gzip), with identifiable `SettingsPage` (190.14 kB), `SubDesignPage` (199.88 kB), and `LearningPage` (63.67 kB) chunks.
- `RouteChunkBoundary` provides focused loading/error states and preserves a keyboard route back to the primary conversation.
- `npm run build`, `smoke-route-lazy-loading.mts`, and `npm run smoke:built` pass; the latter exercises the built renderer and Electron settings navigation lifecycle.
