# 02 — 離線快取 catalog 後備＋如實標示

Status: 可交給代理
Effort: subscription-surface-hardening

## 問題

cli-subscription-pi-loop spec L26／story 9 承諾：「離線時退回最後快取的 catalog 並如實標示」。三輪審查均確認完全未實作且無票認領：catalog 在 Host 啟動時組裝一次，任何地方都沒有 cached/stale 概念；組裝失敗只會得到 `unavailable`＋reason（fail-closed 正確，但沒有承諾的快取後備）。

## 驗收條件

- [ ] Host 端每次成功組裝 catalog 時持久化最後一份（走既有 main-process 設定持久化路徑，不新增儲存機制）。
- [ ] snapshot 組裝失敗或離線時，snapshot 帶最後快取，catalog 物件新增 `cachedAt` 與 `stale: true` 標示欄位；型別擴充維持 bounded 與無 credential 保證。
- [ ] Renderer 對 `stale` 如實渲染過期徽章＋時間；`stale` 未設定的行為完全不變。
- [ ] 完全沒有快取時維持現行 `unavailable`＋reason（ADR-0048：沒量到就缺席，絕不發明）。
- [ ] 投影層測試覆蓋三態：即時／stale 快取／缺席（prior art：smoke-subscription-catalog.mts）。
- [ ] 完成後在 cli-subscription-pi-loop 的 PROGRESS.md 註記本票為該承諾的歸宿。

## 接縫

既有：subscriptionCatalog 純投影 seam。序列化防護沿用既有 token-shape 斷言。不新增接縫。
