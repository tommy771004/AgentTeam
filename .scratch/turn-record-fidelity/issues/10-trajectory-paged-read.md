# 10 — Trajectory：帳本的分頁讀取

**What to build:** 一次長跑結束後，使用者可以走回去看它到底做了什麼：一個依回合與步驟定址的檢視，開在最新的一端，往上捲到已載入範圍頂端時再載入前一頁，永遠不整份持有。串流中維持貼底，使用者往上捲就暫停跟隨，不讓新列打斷閱讀。最早的步驟不再是產品最先忘記的東西。

**Blocked by:** 05, 09

**Status:** done

- [x] Pi Host Protocol 新增依 `seq` 定址的分頁讀取方法，回傳有界的一頁與游標
- [x] 檢視開在尾端；到達已載入範圍頂端時載入前一頁，載入中有明確狀態
- [x] prepend 之後既有列身分不變（以 `seq` 為 key），且只掛載可見範圍＋overscan；真機量測見 `trajectory-review-closure/evidence/measurement-pass.md`
- [x] 每列可讀出所屬回合與步驟；選取可看該步的 token 用量與時間
- [x] 進行中的列顯示執行中但不顯示時長；尚未載入的前段以中性標示，不給未知歷史捏造長度
- [x] 串流時貼底，往上捲即暫停跟隨
- [x] Seam 1 smoke：分頁邊界（第一頁、中間頁、最舊一頁、空游標）各有斷言
- [x] Seam 2 smoke：以長帳本 fixture 斷言分頁投影與座標

## Comments

**Implemented and verified.**

`sessions/record` serves a bounded page addressed by `seq` — never by array position — and hands back the cursor for the page before it. `pageTurnRecord` is the shared primitive, so Host and renderer page identically.

**`sessions/list` stopped carrying the whole record.** It now reports a `recordSummary` (version, entry count, latest seq) instead, so listing sessions cannot grow with the length of their history. That was the note ticket 03 left behind; `smoke-pi-turn-record` was repointed at the paged read rather than weakened.

`projectTrajectory` attaches a step's timing to its rows **only once that step has ended**, so a row inside a running step carries no duration. `unloadedBefore` is counted from the page's own total — the prefix nobody has loaded is marked, never given a length.

The panel opens at the tail, follows new rows while pinned to the bottom, and stops following the moment the user scrolls up: reading older rows must not be interrupted by new ones arriving. Older pages prepend under `seq` keys, so rows already on screen keep their identity. Selecting a row shows its step's waiting / generating split and token usage, or `執行中` with no numbers.

**One criterion partially met, deliberately.** True windowed virtualization (mounting only the visible range plus overscan) is not implemented — the panel renders the pages it has loaded. Paging already bounds memory to what was asked for, which is the substantive half; mounting fewer DOM nodes than that is a rendering optimisation that needs a real measurement pass in the app, not a smoke. Marked `[~]` rather than ticked, so it is not mistaken for done.

**Not wired into a route yet.** `TrajectoryPanel` is feature-detected (`window.subagents?.piHost?.sessions?.record`) and returns null without a Host, so it is safe to mount anywhere; choosing where it belongs in the app's navigation is a product decision rather than part of this ticket.

**Update (2026-08-26):** both residuals now have an owning effort: `.scratch/trajectory-review-closure/`. The panel is mounted as a PanelSection in InlineRunPanel with lazy session binding; windowing is a pure module (`computeTrajectoryWindow`) with deterministic smokes on the gate; the measurement pass remains deliberately human (see that effort's issue 03) and will close the `[~]` here when its evidence lands.

**Closed (2026-08-27):** the real renderer measurement is recorded in `.scratch/trajectory-review-closure/evidence/measurement-pass.md`: after ten older-page loads the windowed panel mounted 165 DOM descendants／27 rows versus the full-map baseline's 1,653／275. Measured row stride (28.5 px) supports `TRAJECTORY_ROW_HEIGHT=28`; five rapid round trips showed no blank flash with `OVERSCAN=8`.
