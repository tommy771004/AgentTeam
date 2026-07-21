# 04 — engine 瘦身為 adapter + 舊檔刪除 + drift guard

Status: resolved
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

## 驗收(已完成)

- [x] `npx tsc -b` 綠;`agent/engine.ts` 行數不設死線(808 行,見上「修正預期」)。
- [x] `agent/stepExecutor.ts`、`agent/stepStrategies.ts` 兩個 ticket-02 shim 已刪(重新確認過 0 importer:`stepExecutor.ts` 只剩 `smoke-step-executor.mts` 一個 import,已改指向 `agent/loop/stepIO.ts`;`stepStrategies.ts` 已 0 importer,直接刪)。
- [x] `agent/conversationLoop.ts` 已刪 —— 重新確認仍是 0 production importer(only `agent/loop/*` files skip this check; grep 精確比對 import 語句,非子字串)。**修正**:ticket 03 完成時的初步檢查誤判此檔已不存在(`cat` 指令被 shell hook 干擾回報假陰性),本 ticket 開工時用 `ls -la` + `git ls-files` 重新確認檔案確實存在、內容與 spec 描述相符(13 行 facade,0 caller)才刪除。
- [x] drift guard smoke(`smoke-caps.mjs` 新增 2 則):純函數 `findLoopRunnerImportDrift(files)` 解析每個 import specifier 相對於 importer 自身路徑,而非字串比對 —— fixture 測試涵蓋「乾淨案例」「同目錄違規」「跨目錄相對路徑違規」三種,另有一則對整個 `src/` 實際樹掃描(`fs.readdirSync(recursive:true)`),確認目前僅 `engine.ts` 合法 import `agent/loop`。
- [x] `smoke-step-executor.mts` 移除兩則 regex-on-engine.ts/strategies.ts 的段落(`DIAGNOSE: ... must use resolveHeuristicStepOutcome` 與 `... wires stepIO helpers`)—— 行為已由 `smoke-step-run.mts`(ticket 02)/`smoke-loop-runner.mts`(ticket 03)的真實 scripted-transport 執行取代,不再需要字串比對源碼；保留的純函數斷言(resolveHeuristicStepOutcome 回歸測試、buildStepCapabilityPreload、simulateStepOutput、formatSimulationStepOutput)true-import 改指向 `agent/loop/stepIO.ts`。
- [x] CLAUDE.md「Engine」節重寫為「Loop Runner (`agent/loop/`) and the Engine adapter (`agent/engine.ts`)」—— 明確寫出 Parse/trigger 驗證/HITL 逾時留 engine,四 pattern/DoD/replan/continueGoal 持久化/per-step 執行在 loopRunner,避免未來 review 誤判 808 行是殘留執行核心。
- [x] 既有 smoke chain 全綠(`npm run smoke`,官方 merge-bar 依據)。
- [x] `git grep -l "stepStrategies\|stepExecutor" -- app/src app/scripts` 零結果。

**發現但範圍外**:`npm run smoke:ci`(含 `smoke:security`)在本 branch 上失敗,但 `git diff main -- <被標記的檔案>` 確認被標記的 `smoke-text-sanitize.mts`/`smoke-sanitized-workspace.mts` 完全未被本 effort 改動 —— 該 secret-scan gate 在 `main` 上即已失敗(既有測試 fixture 內的假 API key 字串觸發,`security-gates.mjs` 無 per-file/per-line allowlist 機制)。`smoke-llm-transport.mts`(ticket 01)沿用同一 fixture 慣例,同樣被標記,但問題根源與本 effort 無關,不在本 ticket 修復範圍。spec.md 的 merge-bar 依據是 `npm run smoke`(該鏈已全綠),非 `smoke:ci`。

## Comments
