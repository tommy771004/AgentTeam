# 量測 pass 程序（issue 03 — 人工執行）

目的：用真數字背書「長 run 撐得住」，並定案兩個常數。**沒有數字，issue 03 不得勾。**

## 準備

1. 本分支（虛擬化已生效）。`npm run dev` 開 app。
2. 任選一個有 Host session 的 thread，打開任一 run 的「執行軌跡」section。
3. 臨時把面板改為吃 fixture（量完還原）：

```tsx
// components/InlineRunPanel.tsx 內，僅供量測：
import { createFixturePageLoader } from '../scripts-fixtures/trajectory-measurement-fixture'
<TrajectoryPanel sessionId="fixture" loadPage={createFixturePageLoader(20_000)} />
```

> fixture 檔在 `app/scripts/trajectory-measurement-fixture.mts`；若 import 路徑不便，
> 複製一份到 `src/` 底下量測後刪除。20_000 turns ≈ 100_000 列。

## 要量的數字

在 DevTools console（面板展開、捲到中段時）：

```js
const s = document.querySelector('[data-trajectory-scroll]')
s.querySelectorAll('*').length                                  // A：掛載節點數
Math.round(s.scrollHeight / s.querySelectorAll('button[aria-pressed]').length) // B：實際平均列高
```

| 量測 | 本分支（虛擬化） | main（全量 map） | 判讀 |
|---|---|---|---|
| A（捲到中段） | 待填 | 待填 | 本分支應 ≈ viewport/rowH+1+2×8 列 × 每列節點數，與總頁數無關 |
| A（連按「載入更早」×10 後） | 待填 | 待填 | 本分支應幾乎不變；main 線性上升 |
| B（實際列高 px） | 待填 | — | 若偏離 30，更新 `TRAJECTORY_ROW_HEIGHT` 並重跑 `smoke-trajectory-window` |
| 捲動主觀順暢度（快速拖曳捲軸 ×5 次） | 待記 | 待記 | 記錄是否有可感知卡頓 |

## 定案

- 把數字寫進本目錄 `evidence/measurement-pass.md`（含日期、機器、解析度）。
- 依 B 修正 `TRAJECTORY_ROW_HEIGHT`；若中段快速捲動出現空白閃爪，調大 `OVERSCAN`（元件內常數），重跑 `node --experimental-strip-types scripts/smoke-trajectory-window.mts`。
- 完成後把 issue 03 的對應框勾掉、Status 改 `resolved`，並在 turn-record-fidelity #10 的 `[~]` 下補一行指向本證據。
