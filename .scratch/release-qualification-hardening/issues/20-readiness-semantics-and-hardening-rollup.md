# 20 — Readiness semantics 與 repository hardening rollup

**What to build:** 將 README、Development State、tracker 與 qualification reports 對齊同一 readiness vocabulary，並為整個 effort 產生一 hop 可查核的 repository hardening qualification。

**Blocked by:** 12 — Critical release hardening qualification；13 — Route-level lazy loading；18 — Smoke ownership 與 source-text guard migration；19 — Production unused-code enforcement。

**Status:** 可交給代理

- [ ] 文件清楚區分 compile success、deterministic qualification、platform qualification、release-ready 與 Paid Beta GO。
- [ ] Plain-browser mode 明示為 UI/degraded preview，不宣稱 production Pi Core Host execution。
- [ ] Final rollup 引用每張完成票的 owning gate evidence，且 tracker links 全部存在。
- [ ] Missing external signed-platform evidence 時 Development State 與 Paid Beta report 仍保持 NO-GO，不以 automated green 覆蓋。
- [ ] `build`／`dist:*` compilation/packaging-only 契約、full smoke 與 explicit platform qualification 分工在文件與 scripts 中一致。
- [ ] 只有在專案既有 resolved 證據定義滿足時才更新 tracker status；否則保留真實 frontier/blocker。
