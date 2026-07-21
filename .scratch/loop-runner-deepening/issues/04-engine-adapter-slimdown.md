# 04 — engine 瘦身為 adapter + 舊檔刪除 + drift guard

Status: 可交給代理
Type: task
Blocked by: 03

## 背景

spec.md 決議 6、7、10。中繼委派收尾:engine.ts 縮為 ~200 行 production adapter — `AgentEngineRegistry`、`start()` 組 `LoopRequest`/`LoopDeps` 轉發、`publish → this.state + emit()` 接線、`resolveIntervention → ask` 橋接、`configure()` live-apply(spec 風險 3:進行中 loop 的 settings 更新行為維持現狀)。

## 變更範圍

- `agent/engine.ts`:刪除已搬空的 orchestration;對外 API(`agentEngine.start/abort/configure/subscribe/resolveIntervention`)簽名不變 — coordinator 零改動。
- 刪檔:`agent/stepExecutor.ts`(shim)、`agent/stepStrategies.ts`、`agent/conversationLoop.ts`(13 行 0 caller)。
- Drift guard(比照 dispatchThreadTask guard 的做法,掛進 smoke chain):production 碼中除 `agent/engine.ts` 外 import `agent/loop` → fail;`scripts/smoke-*.mts` 豁免。
- 刪 `scripts/smoke-step-executor.mts` 的源碼 regex 比對段(純函數 true-import 斷言若仍適用則搬往 smoke-step-run)。
- CLAUDE.md 架構節同步:Engine 段落改述 Loop Runner(`agent/loop/`)+ engine adapter;移除 stepExecutor/stepStrategies 路徑引用。

## 驗收

- [ ] `agent/engine.ts` ≤ ~250 行;`npm run build` 綠。
- [ ] drift guard smoke:對 `agent/loop` 的違規 import 有 fixture 級驗證(暫時加一行違規 import 應 fail,移除後 pass)。
- [ ] 既有 smoke chain 全綠(dist 門檻恢復可包)。
- [ ] `git grep -l "stepStrategies\|stepExecutor\|conversationLoop" app/src` 僅剩 `agent/loop/` 內部與 smoke。

## Comments
