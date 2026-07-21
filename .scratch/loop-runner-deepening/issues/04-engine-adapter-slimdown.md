# 04 — engine 瘦身為 adapter + 舊檔刪除 + drift guard

Status: 可交給代理
Type: task
Blocked by: 03

## 背景

spec.md 決議 6、7、9、10。ticket 03 已將四 pattern + DoD/replan/continueGoal 持久化 + learning hooks 遷出,engine.ts 由 1702 行降到 808 行。**修正預期**:spec.md 原估「~200 行」是在「Parse 也隨 loop 一起搬」的假設下寫的;ticket 03 開工前二次確認 Parse(啟發式+LLM 解析)、continueGoal 恢復、專案指引、trigger 驗證留在 engine 屬 CONTEXT.md 既有邊界(Parse 是獨立於 Loop Pattern 執行的概念)。本 ticket **不再嘗試把 engine.ts 壓到 250 行** —— 808 行主要是合理保留的 Parse 階段邏輯,不是殘留的執行核心。本 ticket 範圍收斂為:清掉已確認孤兒的舊檔案 + 補 drift guard + 文件同步。

## 變更範圍

- 確認 `agent/engine.ts` 對外 API(`agentEngine.start/abort/configure/subscribe/resolveIntervention`)簽名不變 — coordinator 零改動(ticket 03 已如此,本 ticket 只需驗證,非重新設計)。
- 刪檔:`agent/stepExecutor.ts`(shim,ticket 02 建立)、`agent/stepStrategies.ts`(shim,ticket 02 建立)。`agent/conversationLoop.ts`(13 行 0 caller)：需重新確認目前是否仍 0 caller 再刪,不假設 ticket 01–03 未動到它。
- Drift guard(比照既有 `dispatchThreadTask` guard 的做法,掛進 smoke chain):production 碼中除 `agent/engine.ts` 外 import `agent/loop/*` → fail;`scripts/smoke-*.mts` 豁免。
- 刪 `scripts/smoke-step-executor.mts` 的源碼 regex 比對段(`DIAGNOSE`/`engine wires` 兩則,ticket 02 已改指向 `agent/loop/stepIO.ts`+`strategies.ts` 但仍是 regex;純函數 true-import 斷言若仍適用則保留或搬往 smoke-step-run.mts)。同時檢查 `scripts/smoke-caps.mjs` 是否還有 ticket 01–03 期間改過的 regex 斷言可以一併簡化(非必須,順手清)。
- CLAUDE.md 架構節同步:Engine 段落改述 Loop Runner(`agent/loop/`)+ engine adapter(Parse 留 engine 需明確寫出,避免未來 review 誤判為殘留執行核心);移除 stepExecutor/stepStrategies 路徑引用。

## 驗收

- [ ] `npm run build` 綠;`agent/engine.ts` 行數不設死線(見上「修正預期」),但需確認沒有 ticket 03 遺留的死碼(`git grep` 交叉核對本檔案私有方法呼叫)。
- [ ] drift guard smoke:對 `agent/loop` 的違規 import 有 fixture 級驗證(暫時加一行違規 import 應 fail,移除後 pass)。
- [ ] 既有 smoke chain 全綠(dist 門檻恢復可包)。
- [ ] `git grep -l "stepStrategies\|stepExecutor" app/src` 僅剩 `agent/loop/` 內部與 smoke;`conversationLoop` 依重新確認結果處理。

## Comments
