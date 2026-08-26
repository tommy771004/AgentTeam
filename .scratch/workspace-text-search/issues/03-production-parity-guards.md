# 03 — 生產路徑等價接線＋防復發 guards

**What to build:** 在 Electron 的 Pi 生產路徑上，同名 renderer-seam 版本讓位給 Host 版本（ADR-0027 行為等價取代）；plain-browser 降級路徑行為完全不變；繞過開關直接註冊的路徑會被 drift guard 抓住。

**Blocked by:** 02 — Host 檢索工具＋gating（唯一新測試接縫）

**Status:** resolved

- [x] Pi 路徑模型實際呼叫到的是 Host 版工具（renderer 凍結檔案集零改動，既有契約煙霧維持綠燈）
- [x] drift guard：新增繞過 gating 的 pack 註冊會失敗；凍結 seam 無新檔案的既有 guard 不破
- [x] 手動 dev 驗證：切換開關→下一 run 生效，進行中 run 不變

## Closure evidence

`npm run build` 的 Pi contract guard 與完整 `npm run smoke` 全綠；專屬 19-case smoke 證明 Host 生產入口、巢狀重入與 frozen per-run availability，run 中切換不改既有 snapshot。Browser 實點確認開關只更新持久設定，reload 後生效且可還原 OFF。
