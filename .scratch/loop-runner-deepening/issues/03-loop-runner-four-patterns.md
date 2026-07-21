# 03 — loopRunner 四 pattern + publish/ask ports + 型別化觸發證據

Status: 可交給代理
Type: task
Blocked by: 02

## 背景

spec.md 決議 1–4。`start()`(engine.ts:332–789)與四個 pattern method(runTurnBased / runGoalBased / runTimeBased / runProactive)搬入 `agent/loop/loopRunner.ts`;DoD 評估、replan、continueGoal restore 一併進來。`LoopRequest` discriminated union 承載型別化證據,`runLoop` 入口唯一 fail-closed 斷言(CONTEXT.md「Time-based / Proactive trigger」詞條)。

## 變更範圍

- 新建 `agent/loop/loopRunner.ts` + `agent/loop/index.ts`(僅 export `runLoop`)。
- `LoopRequest` union(spec「對外 interface 契約」);`ScheduledJobClaim` / `EventEvidence` 型別自 scheduler / eventMatcher 現有形狀取用,不新造發證。
- `deps.ask` 逾時政策移入 runner:unattended 45s / 互動 90s / safety 900s,逾時 auto-deny;常數集中一處。
- `deps.publish` 為唯一側效出口;intervention 狀態進 snapshot。
- engine 四個 pattern method 改為組 req + deps 後委派(中繼狀態,ticket 04 收尾)。

## 驗收

- [ ] 新 smoke `scripts/smoke-loop-runner.mts`:
  - Goal:scripted transport 令 DoD 首輪 fail → replan → 次輪 met,斷言迭代次數與 outcome。
  - Turn:單輪完成。
  - time / proactive 無 claim / evidence → 入口 refused(fail-closed);帶合法證據 → 執行。
  - ask 逾時(fake ask 永不 resolve + 縮短時鐘)→ auto-deny。
  - publish snapshot 序列:status 遞進(running → … → completed/halted)形狀斷言。
- [ ] 既有 smoke chain 全綠。

## Comments
