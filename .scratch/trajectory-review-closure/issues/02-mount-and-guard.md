# 02 — 掛載＋入口＋防復發 drift guard

**What to build:** 把既有 `TrajectoryPanel` 掛進 `InlineRunPanel` 的 PanelSection 序列（「執行軌跡」），sessionId 由 threadId 經既有 bridge 的 `sessions.list()` 解析（最新一筆未封存的綁定）；解析不到就整段隱藏——隱藏，不是停用。展開狀態記在 localStorage。面板改用 01 的窗口模組渲染（seq 身分、貼底跟隨、選取詳情行為不變）。加一支 source-text drift guard：run 面板容器必須引用軌跡面板、面板必須仍走窗口模組與 feature-detect——「建成但沒人 mount」不得悄悄復發。

**Blocked by:** 無（與 01 並行）。

**Status:** resolved

## 驗收條件

- [x] 使用者可在任一有 Host session 綁定的 run 上打開「執行軌跡」並回看分頁歷史。
- [x] plain browser（bridge 缺席）下入口與面板都不出現，不出現壞按鈕。
- [x] 展開狀態跨重新掛載保留。
- [x] drift guard 斷言：容器引用面板、面板引用窗口模組、feature-detect 在位；移除任一即紅。
- [x] guard 掛進 `npm run smoke`。

## Comments

**Implemented and verified.**

- **掛載**：`InlineRunPanel` 的 PanelSection 序列新增「執行軌跡」（id `run-trajectory`，摘要「回看 Turn Record」），與「上下文」同構；容器給固定高度讓內部捲動成立。
- **sessionId 解析是惰性的**：只在讀者展開 section 時呼叫既有 bridge 的 `sessions.list()`，取該 thread 最新一筆未封存綁定；解析不到（plain browser、非 Host runner、無綁定）整段隱藏——先檢查 `sessions.record` 是函式，bridge 缺席直接判 null。TDD 先行：`smoke-trajectory-panel-mounted.mts` 在實作前以正確訊息轉紅（「不得再次變成無人掛載的孤兒元件」）。
- **展開狀態**記在 localStorage（`subagents.runPanel.trajectoryOpen.v1`），寫入失敗不影響切換。
- **窗口化**：面板改為消費 `computeTrajectoryWindow`／`TRAJECTORY_ROW_HEIGHT`（OVERSCAN=8，量測 pass 擁有此數）；渲染的是切片後的 `mountedRows`＋上下 spacer；guard 明文禁止 `view?.rows.map(` 復發。seq key、貼底跟隨、選取詳情 footer 全部保留。
- **prepend 錨定**：載入更早頁前記下讀者所在列的 seq 與索引，merge 後的 pre-paint layout effect 以 `anchorScrollTopAfterPrepend` 校正 scrollTop——正在讀的那一行停在原位；跟尾狀態下錨定讓位給貼底。
- **ResizeObserver** 對捲動容器重算窗口；scroll handler 只在區間實際變化時 setState。

證據：兩支新 smoke 綠（window、panel-mounted）、鄰接的 paging/live-timeline smoke 綠、`npm run build`（含 check:pi-contract 等 guard）全綠、oxlint 0 warnings。

**Code review 後修正（2026-08-26）。**

- guard 的 feature-detect 斷言原本允許「含 sessions 與 record 字樣」的鬆散替代——改為釘死 `piHost?.sessions?.record` 本體，並把三個斷言收成具名 predicate，guard 內建**負向自證**（unmount／全量 map／刪偵測三種變異各自轉紅）。
- 錨定索引改為 **DOM 事實**而非 `scrollTop ÷ 列高`：捲動容器內列的上方還有 spacer 與「載入更早」按鈕，原始算法在 `unloadedBefore > 0`（正是 prepend 情境）時會多算約一個按鈕高的列數，補償逐頁累積漂移。現在錨定讀 `[data-trajectory-row]` 的實際可見列（data-seq／data-index），純函式契約不變、呼叫端餵對索引。
- render 期間寫 ref 改為 pre-paint 的 useLayoutEffect 鏡像（宣告序在前，anchor/sync effects 讀到本輪真值）。
- session 綁定從「取最新」改為**取第一筆未封存**——與 `submitPiHostRun` 的 `.find()` 對齊，否則面板可能展示與實際提交不同的 session；同時補上 `list` 函式存在的檢查（有 record 無 list 的 bridge 不再同步丟例外）。
- localStorage 讀寫簡化為 `'true'` 字面比較；面板 fallback range 改呼叫 `computeTrajectoryWindow` 本身（不再手拼 literal）；模組新增共用 `EMPTY_TRAJECTORY_WINDOW_SLICE`。
- fixture 分頁改為委託出貨的 `pageTurnRecord`（補 `version` 欄位），不再平行手寫 filter/slice。
