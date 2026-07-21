# 05 — 手動 parity 驗證 + merge bar 勾選

Status: 需人工處理（自動化層已綠；UI 實機仍待勾）
Type: task
Blocked by: 04

## 背景

spec.md 決議 8。一次到位單 PR 的合併門檻中,smoke 覆蓋不到的端對端層(publish → store → UI 即時更新、真人 intervention 解鎖、四 pattern 在真 app 的實際觸發)需人工在 dev app 驗證。

## 自動化已覆蓋（2026-07-21）

透過 `smoke-loop-runner` + `smoke-step-run` + `smoke-loop-parity`（已掛 smoke chain）：

- [x] 四 pattern 邏輯（Turn / Goal DoD+replan / Time fail-closed+claim / Proactive fail-closed+evidence）
- [x] Safety intervention 於 step seam：reject → FAILED；approve → 續跑
- [x] FC multi-round（load_capability → final）+ capability 跨步 union
- [x] continueGoal `initialStepOutputs` seed；mid-run `getSettings` live-apply
- [x] publish 經 `snapshot()` clone（engine adapter）
- [x] unattended 逾時政策純函數（`unattendedInterventionTimeoutSec`，預設 45s / hard floor 15 / cap 120）
- [x] package.json smoke 鏈含 loop / step / transport / parity

## 仍需人工（Electron UI — 合併前勾）

在 `npm run dev` 起 app 後：

- [ ] Turn-based：composer 一般任務，畫面 step / log 隨跑更新
- [ ] Goal-based：含 DoD 目標，觀察迭代與 replan
- [ ] Time-based：建一筆 ScheduledJob 到點觸發（claim 路徑）
- [ ] Proactive：event matcher 實際命中一次（evidence 路徑）
- [ ] 真 intervention：safety 觸發 → UI 顯示 → 核准續跑；再拒絕 → halted
- [ ] UI 即時性：subAgent 面板、tool call 清單無停滯
- [ ] unattended：schedule/webhook 一次，確認短逾時 auto-deny 不阻塞

## 人工快速腳本

```bash
cd app && npm run dev
# 另開終端
npm run smoke   # 確認自動化 merge bar 仍綠
```

勾完上方「仍需人工」後：

1. 將本檔 Status 改為 `resolved`
2. 勾選 `spec.md` merge bar「手動:dev app 四 pattern…」
3. 合併 PR

## Comments

### 2026-07-21 — automated parity slice

- Nits: 移除 orphan `lastDodMissing`；修 `stepIO` indent；HITL 註解對齊 engine 逾時擁有權。
- `hitlTimeout.ts` 抽出 unattended 逾時算術；`smoke-loop-parity.mts` 鎖 merge-bar 自動化項。

### 2026-07-21 — code-review residual (HEAD~3 三 commit 後續)

- Unattended HITL **hard floor 15s**（取消 sub-floor bypass；spec 45/floor15/cap120）。
- Engine final rebind：`this.state = snapshot(loopState)`，與 publish 路徑一致。
- Spec `LoopDeps` 契約補 `getSettings`/`getOverrides`/`initialStepOutputs` + publish live+adapter-clone 語意。
- `smoke-loop-parity` 鏈上自檢含自身 script 名。
