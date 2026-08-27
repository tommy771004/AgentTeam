# 量測 pass 程序（issue 03 — 人工執行）

目的：用真數字背書「長 run 撐得住」，並定案兩個常數。**沒有數字，issue 03 不得勾。**

## 準備

1. 從 `app/` 執行 `npx vite --host 127.0.0.1`。
2. 開啟 `http://127.0.0.1:5173/#/trajectory-measurement`。
3. 此 dev-only route 會以同一個 `createFixturePageLoader(20_000)`（80,000 entries）並排掛載：
   - Windowed：production 視窗演算法。
   - Full map baseline：`windowed={false}`，用來觀察全量 DOM 成長。

不需修改 production 元件，也沒有量完需還原的檔案。

## 要量的數字

在 DevTools console（面板展開、捲到中段時）：

```js
const [windowed, baseline] = document.querySelectorAll('[data-trajectory-scroll]')
const measure = (s) => {
  const rows = [...s.querySelectorAll('button[aria-pressed]')]
  const tops = rows.slice(0, 10).map((row) => row.getBoundingClientRect().top)
  return {
    nodes: s.querySelectorAll('*').length,
    mountedRows: rows.length,
    rowHeight: rows[0]?.getBoundingClientRect().height,
    rowStride: tops[1] - tops[0],
    scrollHeight: s.scrollHeight,
  }
}
[measure(windowed), measure(baseline)]
```

| 量測 | 本分支（虛擬化） | main（全量 map） | 判讀 |
|---|---|---|---|
| A（捲到中段） | 待填 | 待填 | 本分支應 ≈ viewport/rowH+1+2×8 列 × 每列節點數，與總頁數無關 |
| A（連按「載入更早」×10 後） | 待填 | 待填 | 本分支應幾乎不變；main 線性上升 |
| B（實際列距 px） | 待填 | — | 與 `TRAJECTORY_ROW_HEIGHT` 明顯偏離時才更新並重跑 `smoke-trajectory-window` |
| 捲動主觀順暢度（快速拖曳捲軸 ×5 次） | 待記 | 待記 | 記錄是否有可感知卡頓 |

## 定案

- 把數字寫進本目錄 `evidence/measurement-pass.md`（含日期、機器、解析度）。
- 依 B 修正 `TRAJECTORY_ROW_HEIGHT`；若中段快速捲動出現空白閃爪，調大 `OVERSCAN`（元件內常數），重跑 `node --experimental-strip-types scripts/smoke-trajectory-window.mts`。
- 完成後把 issue 03 的對應框勾掉、Status 改 `resolved`，並在 turn-record-fidelity #10 的 `[~]` 下補一行指向本證據。
