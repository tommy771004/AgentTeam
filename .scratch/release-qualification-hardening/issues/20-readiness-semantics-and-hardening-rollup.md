# 20 — Readiness semantics 與 repository hardening rollup

**What to build:** 將 README、Development State、tracker 與 qualification reports 對齊同一 readiness vocabulary，並為整個 effort 產生一 hop 可查核的 repository hardening qualification。

**Blocked by:** 12 — Critical release hardening qualification；13 — Route-level lazy loading；18 — Smoke ownership 與 source-text guard migration；19 — Production unused-code enforcement。

**Status:** 已完成

- [x] 文件清楚區分 compile success、deterministic qualification、platform qualification、release-ready 與 Paid Beta GO。
- [x] Plain-browser mode 明示為 UI/degraded preview，不宣稱 production Pi Core Host execution。
- [x] Final rollup 引用每張完成票的 owning gate evidence，且 tracker links 全部存在。
- [x] Missing external signed-platform evidence 時 Development State 與 Paid Beta report 仍保持 NO-GO，不以 automated green 覆蓋。
- [x] `build`／`dist:*` compilation/packaging-only 契約、full smoke 與 explicit platform qualification 分工在文件與 scripts 中一致。
- [x] 只有在專案既有 resolved 證據定義滿足時才更新 tracker status；否則保留真實 frontier/blocker。

## Implementation evidence

- Root/app README、DEV_STATE、spec、tracker 與 qualification 使用同一五階 readiness vocabulary；plain-browser 明示為 UI/degraded preview。
- `qualification.md` 對 20 張票逐一引用 owning gate，並保留 repository resolved／Paid Beta NO-GO 的不同狀態。
- Paid Beta report 由 release qualification workflow 產生並隨 evidence artifact 上傳；repository qualification 保留 NO-GO（0/49）、hardening BLOCKED（0/6）、external evidence BLOCKED 的狀態記錄。
- `smoke-release-hardening-rollup.mts` 驗證 vocabulary、20/20 ticket links、tracker status 與 repository NO-GO truth；build/dist-only contract另由 `smoke-release-build-once.mts` 鎖定。
