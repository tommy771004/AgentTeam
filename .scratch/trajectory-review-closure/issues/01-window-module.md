# 01 — 純函式視窗模組：只掛可見範圍

**What to build:** 軌跡清單的虛擬化收在一個純函式模組裡：給定已投影列數、列高、overscan、捲動位置與視窗高度，算出該掛載的列區間與上下 spacer 高度；另提供 prepend 後的捲動錨定補償（給定補償前可見首列的舊索引與同一列的新索引，回傳新捲動位置，讓使用者正在讀的那一行停在原位）。元件只消費其輸出。

**Blocked by:** 無。

**Status:** resolved

## 驗收條件

- [x] 空 ledger 回傳空區間、零 spacer；少於一屏時全部掛載、無 spacer。
- [x] 大 ledger：區間＝可見範圍＋上下 overscan，四端 clamp；區間大小與總列數無關（這是「長 run 撐得住」的可機器證明半部）。
- [x] 捲動位置越界（頂／底／負值）被 clamp，不丟例外。
- [x] prepend 錨定：新舊索引差 × 列高即補償量；任一索引未知時回傳原捲動位置不變。
- [x] Smoke 以決定論斷言涵蓋上述全部，且掛進 `npm run smoke`。

## Comments

**Implemented and verified.**

`trajectoryWindow.ts` 兩個純函式，零 DOM、零 React：

- `computeTrajectoryWindow` — 區間是 viewport＋overscan 的函式。smoke 以 5,000 列對 200,000 列在同一捲動位置斷言**完全相同的掛載區間**（大小 37＝ceil(600/30)+1+2×8），spacer 會計恆等式（top+bottom = 未掛載列高總和）逐案例成立；負值／越界／viewport 或 rowHeight 為 0 的退化輸入全部 clamp 不丟例外。`TRAJECTORY_ROW_HEIGHT = 30` 是量測 pass 擁有的數字（ticket 03）。
- `anchorScrollTopAfterPrepend` — 補償量＝索引差×列高；任一索引未知回傳原值不猜跳。

TDD：`smoke-trajectory-window.mts` 先行（RED：ERR_MODULE_NOT_FOUND），實作後 GREEN，已接進 package.json 主 smoke 鏈（緊鄰 `smoke-trajectory-paging`）。證據：本機執行綠；gate 歸屬由鏈上位置保證。
