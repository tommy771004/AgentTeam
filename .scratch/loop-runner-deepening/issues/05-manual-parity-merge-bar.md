# 05 — 手動 parity 驗證 + merge bar 勾選

Status: 需人工處理
Type: task
Blocked by: 04

## 背景

spec.md 決議 8。一次到位單 PR 的合併門檻中,smoke 覆蓋不到的端對端層(publish → store → UI 即時更新、真人 intervention 解鎖、四 pattern 在真 app 的實際觸發)需人工在 dev app 驗證。

## 驗證清單(對照 spec.md merge bar)

- [ ] `npm run dev` 起 app,四 pattern 各跑一次:
  - Turn-based:composer 一般任務。
  - Goal-based:含 DoD 的目標任務,觀察迭代與 replan。
  - Time-based:建一筆 ScheduledJob 到點觸發(驗 claim 路徑)。
  - Proactive:以 event matcher 實際命中一次(驗 evidence 路徑)。
- [ ] 一次真 intervention:safety gate 觸發 → UI 顯示 → 人工核准 → 續跑;再一次人工拒絕 → halted。
- [ ] UI 即時性:step 狀態、subAgent 面板、tool call 清單隨 publish 更新無停滯。
- [ ] unattended 路徑:schedule/webhook 來源一次,確認 45s auto-deny 不阻塞。
- [ ] spec.md merge bar 全項勾選後,方可合併 PR。

## Comments
