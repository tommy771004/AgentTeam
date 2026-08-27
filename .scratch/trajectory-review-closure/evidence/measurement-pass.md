# 量測 pass 證據（issue 03）

> fail-closed 條件已滿足：下列數字由真實 Vite renderer 的 `#/trajectory-measurement` route 量得；同頁並排掛載 windowed 與 `windowed={false}` baseline，兩者共用相同 fixture loader。

- 日期：2026-08-27
- 機器／CPU／RAM：Apple M3 Pro（arm64）／18 GiB；macOS 26.0.1（25A362）
- 解析度／視窗大小：renderer viewport 1280 × 720 CSS px；devicePixelRatio 2
- app 版本／commit：1.1.0／`bc7e737` 加本次未提交修復
- fixture：`createFixturePageLoader(20_000)`（80,000 entries）；每次 Host page 100 entries，投影後每頁新增 25 個可見 trajectory rows
- 方法：在兩個 288 px 高的真 `TrajectoryPanel` 中，逐一連按「載入更早」10 次；以 `[data-trajectory-scroll]` 讀取 descendant node count、mounted row count、scroll geometry，並在中段快速上下捲動各 5 次。

## 數字

| 量測 | 本分支（虛擬化） | main（全量 map） | 判讀 |
|---|---|---|---|
| A：第一頁中段掛載節點數 | 153 nodes／25 rows | 153 nodes／25 rows | 第一頁小於 viewport＋overscan 範圍，兩者預期相同 |
| A：連按「載入更早」×10 後、中段 | 165 nodes／27 rows | 1,653 nodes／275 rows | windowed 僅 +12 nodes；baseline 隨已載入列數增至 10.8× |
| B：實際列高／列距 px | 24.5／28.5 | 24.5／28.5 | 視窗演算法使用列距；28 px 與實測 28.5 px 相差 1.8%，無需調整 |
| 捲動品質（快速上下×5） | 無空白閃爍或可感知卡頓；10 次往返 139 ms | 無明顯空白；10 次往返 181 ms | `OVERSCAN=8` 足以涵蓋本機快速捲動；時間只作同次觀測，不作跨機 benchmark |

## 定案

- `TRAJECTORY_ROW_HEIGHT` 維持 28 px：它代表含 gap 的列距，實測 28.5 px，誤差不足一個 pixel。
- `OVERSCAN` 維持 8：264 px viewport 約 10 列；上下各 8 列後實際掛載 27 列，快速往返未見空窗，而 275 列 baseline 已產生 10 倍 DOM。
- `node --experimental-strip-types scripts/smoke-trajectory-window.mts`：`smoke-trajectory-window: green`。

## 執行程序

見 [../measurement-pass.md](../measurement-pass.md)。本次使用 repo 內既有的永久 dev-only measurement route，沒有臨時修改或待還原檔案。
