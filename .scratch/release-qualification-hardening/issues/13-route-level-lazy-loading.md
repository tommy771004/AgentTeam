# 13 — Route-level lazy loading

**What to build:** 讓低頻頁面離開 initial renderer bundle，在不延遲 primary conversation 與 startup authority bootstraps 的前提下，降低首次載入 JavaScript。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] 先以 production measurement 建立 initial chunk 與主要 route chunks baseline。
- [ ] Settings、SubDesign、Learning 等低頻 routes 在首次進入時才載入，primary conversation 與必要 bootstraps 保持 eager。
- [ ] Loading/error boundaries 在 desktop 與 narrow viewport 可用，鍵盤 focus 與 navigation continuity 不退化。
- [ ] Production build 顯示 initial chunk 實質下降，route chunks 可辨識且沒有把共用大依賴複製多份。
- [ ] Built Electron smoke 與 plain-browser degraded preview 都保持可啟動。
