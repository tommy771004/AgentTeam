# 10 — 真實重啟 e2e

Status: resolved
Spec: `.scratch/active-run-reattachment/spec.md`

## What to build

一條真正的 Electron e2e:對**真實的 Pi Core Host（protocol v3）** 起一個 run,在執行中途銷毀並重建 renderer,然後驗證它從 Host journal 重新附著、時間軸重建、繼續收到更新、可以取消、並且恰好結算一次。

02 的 fixture 證明協調邏輯在每個競態下都對;這條 e2e 證明**真實時序**下整條路徑真的接得起來——訂閱時機、IPC 生命週期、保留與 ack、容量重建,這些是 fixture 看不到的。兩者互補,缺一不可。

比照既有 `smoke-pi-electron-host-e2e.mjs` 的既有模式,不新增第二套 e2e 框架。至少覆蓋兩個時點:tool 執行中重啟、以及 Host terminal append 之後但 finalization 之前重啟(後者是最容易掉結果的一刻)。

e2e 必須穩定:不得靠固定 sleep 對時序下賭注,要等可觀察的狀態。

## Acceptance criteria

- [x] 對真實 Pi Host 執行,非 mock
- [x] tool 執行中銷毀並重建 renderer:時間軸重建且繼續更新
- [x] Host terminal append 之後、finalization 之前重啟:結果仍到得了使用者
- [x] 重新附著後可取消,且取消確實生效
- [x] 恰好結算一次(摘要／metrics／Archive 不重複)
- [x] 沿用既有 e2e 模式,未新增第二套框架
- [x] 等可觀察狀態而非固定 sleep;連跑數次不 flaky
- [x] 掛進既有 smoke 鏈的適當位置

## Blocked by

06 — 跨 renderer 實例的冪等結算

## Implementation evidence (2026-08-26)

- `smoke-pi-electron-host-e2e.mjs` 使用既有 Electron launcher、真實 utility-process Pi Host 與 loopback model fixture；run 本身由真實 Host 執行 Bash tool。
- active case 在 Host attachment 可觀察後 reload renderer，驗證 timeline/controls 回復、後續 seq 抵達及 cancel settlement；terminal case 在 Host terminal append 與 app finalization 之間以 launcher IPC gate reload，驗證 replacement renderer 取得 CAS、只 Archive/ack 一次。
- 所有等待均輪詢可觀察狀態並有 deadline；修正 startup/finalization deadlock 後，連續四次命令均通過，每次輸出 `2 active + 2 terminal cases`。入口為獨立的 `npm run smoke:pi-electron-host-e2e`，避免把真 Electron e2e 混入快速 unit smoke。
