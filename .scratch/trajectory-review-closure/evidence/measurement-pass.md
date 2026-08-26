# 量測 pass 證據（issue 03 — 人工執行後填寫）

> fail-closed：本文件存在且含數字之前，issue 03 不得勾、trf#10 残項不得收。

- 日期：（待填）
- 機器／CPU／RAM：（待填）
- 解析度／視窗大小：（待填）
- app 版本／commit：（待填）
- fixture：`createFixturePageLoader(20_000)`（= 80_000 entries；2026-08-26 已由代理驗證 loader 可跑：total=80000，每頁 100 列，頁序嚴格遞減）

## 數字

| 量測 | 本分支（虛擬化） | main（全量 map） | 判讀 |
|---|---|---|---|
| A：捲到中段掛載節點數 | 待填 | 待填 | 本分支應 ≈ viewport/rowH+1+2×OVERSCAN 列 ×每列節點數，與總列數無關 |
| A：連按「載入更早」×10 後 | 待填 | 待填 | 本分支應幾乎不變；main 線性上升 |
| B：實際平均列高 px | 待填 | — | 偏離 30 則更新 `TRAJECTORY_ROW_HEIGHT` 並重跑 smoke-trajectory-window |
| 捲動主觀順暢度（快速拖曳×5） | 待記 | 待記 | 有可感知卡頓則調大 OVERSCAN |

## 定案

- `TRAJECTORY_ROW_HEIGHT` 維持／改為：（待填）
- `OVERSCAN` 維持／調整為：（待填；理由）
- `node --experimental-strip-types scripts/smoke-trajectory-window.mts` 重跑結果：（待填）

## 執行程序

見 [../measurement-pass.md](../measurement-pass.md)（fixture 注入步驟＋DevTools console 片段）。量完還原兩處暫改。
