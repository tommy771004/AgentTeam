# 任務完成事件的可到達性:重啟補送、全域通知與誠實終態

> 狀態:`ready-for-agent`(無 issue tracker,以此欄位代替)
> 來源:2026-08-23 session — 與 hermes-agent(NousResearch)任務執行機制的對照分析
> 詞彙:CONTEXT.md(Chat turn / Task run / Task run coordinator / Execution evidence / UI Projection);ADR-0040(durable journal)、ADR-0042(replay-safe checkpoints)、ADR-0048(model cannot manufacture execution evidence)

## Problem Statement

一個 run 動輒跑數分鐘到數十分鐘。在這段時間裡,使用者的注意力不在 run 上——切去別的 thread、別的 page、甚至關掉 app。此時發生三件讓使用者失去信任的事:

1. **App 重啟後,「任務完成了」這件事消失了。** 啟動復原會把中斷的 run 標記為 interrupted、貼出復原報告,但一個**在關閉前後之間正常完成**的 run 只留下 journal 裡的 terminal 標記;擁有它的 thread 收不到任何敘事。使用者重開 app 看到的 thread 像什麼都沒發生過——狀態恢復了,事件沒有。
2. **離開 run 的畫面 = 收不到完成。** 完成訊息只存在於該 thread 的 bubble 和已開啟的 process feed。使用者在 SubDesign build 跑 20 分鐘時切去看別的東西,完成的那一刻沒有任何跨畫面信號;他回來只能自己翻。
3. **做完了和做完了看起來一樣。** 觸到 `maxIterations` 上限而收尾的 run,終態仍是 completed/success,DoD 未達成的事實藏在 orchestration 快照裡。一般使用者無法分辨「agent 認為做完了」和「agent 用完預算被截斷了」。這直接違反本產品的硬約束:報告內容必須讓非技術業主看得懂。

## Solution

把 run 的終點變成一個**可到達的事件**,而不是留在原地的狀態:

- Finalization 時,journal 除 terminal 標記外,記錄「擁有者 thread 當時是否可投遞」。重啟時,啟動復原管線對「完成但未投遞」的 run 在其 thread 補一則系統 bubble;無法證明 side effects 發生的(擁有程序消失、replay checkpoint 不存在)如實標記為未知結果,不宣稱成功也不宣稱失敗——沿用 ADR-0048 的語意。
- Run 從 live 轉為 terminal 的瞬間,app 殼層呈現一次全域完成通知(OS notification + 殼層內 toast),不論使用者當下在哪個畫面。
- lifecycle 投影吃進 orchestration 的迭代資料,把「預算用盡」從隱藏事實升級為一等終態文案:「已完成(未達 DoD:用盡 N 輪上限)」這類一句話,出現在 feed 終態列與 run summary。

## User Stories

1. As a 使用者, I want 我離開 app 期間完成的任務在重啟後自動補上一則「任務已完成」的訊息, so that 我不必猜測或翻找就任務的下落
2. As a 使用者, I want 重啟後的補送訊息包含 objective、結束時間與結果摘要, so that 訊息本身可讀而不只是一個 id
3. As a 使用者, I want 無法確認結果的 run 被明確標為「結果未知」, so that 我不會把未證實的成功拿去做下游決策
4. As a 使用者, I want 補送的訊息落在擁有該任務的 thread 而非任意活躍 thread, so that 敘事跟著任務走而不是跟著視窗走
5. As a 使用者, I want 每個未投遞的完成事件只補送一次, so that 反覆重啟不會累積重複訊息
6. As a 使用者, I want run 完成的瞬間收到 OS 層級通知(即使 app 在背景), so that 我可以決定何時回來看
7. As a 使用者, I want 回到 app 內任何畫面時看到一則不打斷工作的完成 toast, so that 我知道可以回去檢查成果
8. As a 同時跑多個任務的使用者, I want 多個 run 接連完成時通知合併而非轟炸, so that 通知是幫助而不是噪音
9. As a 正在盯著 process feed 的使用者, I want 我正在看的 run 完成時不再重複跳出 toast, so that 已在眼前的資訊不被複製
10. As a 使用者, I want 失敗與中止的 run 也走同樣的通知路徑(不同樣式), so that 壞消息和好消息到達得一樣快
11. As a 使用者, I want 點擊完成通知直接跳到該 thread 或 run 面板, so that 通知是一扇門而不是死文字
12. As a 非技術業主, I want 任務結束列明確告訴我「完成了」還是「時間/次數用完了沒做完」, so that 我照畫面就能理解結果
13. As a 非技術業主, I want 未達 DoD 的說明附帶人話解釋(做了幾輪、上限幾輪), so that 我能判斷要不要再給一次機會
14. As a 使用者, I want 這個終態語彙在 process feed、run summary card、SubDesign header 三處一致, so that 不會有兩種說法
15. As a 審計需求的使用者, I want iteration-exhausted 的紀錄保留在 run summary 與 archive, so that 事後可查證當時是怎麼收尾的
16. As a 使用者, I want SubDesign build/critique 的完成同樣觸發全域通知, so that 工作流內的長工與一般任務行為一致
17. As a 使用者, I want 通知可在設定中靜音(保留 thread 內訊息), so that 我保有對打斷程度的控制
18. As a 開發者, I want 補送邏輯完全走既有啟動復原管線而非新開第二條恢復路徑, so that 恢復語意只有一個 owner
19. As a 開發者, I want 「是否已投遞」的判定由 journal 單點記錄, so that UI 不各自猜測造成重複或漏送
20. As a 使用者, I want 外部 CLI run 的完成也遵守同樣規則且不宣稱 DoD, so that runner 能力差異不影響事件到達

## Implementation Decisions

- **單一投遞語意的 owner 是 run journal**(ADR-0040 的既有模組)。Finalization 路徑在記 terminal marker 的同一同步段落,為每個 terminal run 記錄投遞狀態:`delivered`(擁有 thread 當時有活躍 renderer 且 bubble 已寫)/ `pending-delivery`(terminal 但 thread 未消費)。journal entry 形狀沿用 bounded metadata 原則——存 runId/threadId/status/timestamps,不存 prompt 或 payload。
- **重啟補送走 `reconcileStartup()` → recovery report → App.tsx 既有的系統 bubble + OS notify 路徑**,不改變其 fail-closed 行為:目前管線把 interrupted/quarantined 列進報告,本次擴充是把「success 但 pending-delivery」也納入同一份報告、逐項投遞到各自的 thread。投遞成功的 entry 標記 consumed,保證 once-only;無法對應到存活 thread 的 entry 如實以「結果未知」項目呈現(對齊 Hermes delegation 對 stranded 任務的 `unknown` 記法,以及 ADR-0048)。
- **外部 CLI run 不因補送獲得 DoD 語意**:pending-delivery 補送的文案區分 `executionKind`;external 一律「已結束」,不宣稱完成定義已滿足(現有 capability matrix 延伸到補送文案)。
- **全域完成通知是殼層職責,不是 store 職責**。Layout 層(已持有 `runningThreadIds` 與 `isRunning`)監看 per-run registry 的下降緣,對每個剛 terminal 的 runId 發一次 OS notify(`window.subagents?.notify`,main process 已有 `app:notify` handler)+ 殼層內 toast;toast 元件新增於 primitives 層,自動消失、可堆疊上限 3 則、超出合併為「N 個任務已完成」。
- **抑制規則在殼層判定**:run 的 process feed 目前可見(使用者已在現場)→ 只更新 feed 不另發 toast;thread 正是當前活躍 thread → 同上。OS notify 是否發出受設定開關控制(thread 內訊息不受影響)。
- **iteration 耗盡升格為 lifecycle 語彙**:`deriveRunLifecycle` 的 input 增加選填的 orchestration 迭代資料(iterations / maxIterations / dodMet,Pi Host settlement 已攜帶)。當 status 為 success 而 `dodMet === false` 且 iterations ≥ maxIterations,lifecycle 輸出的 phase 保持 terminal、label 改為「已完成(未達 DoD · 用盡 N 輪)」、tone 降為 attention 級;icon 不沿用 success 的勾。HITL 與 activity-phase 優先序維持不變。
- **三處消費同一投影**:RunProcessFeed 終態列、ThreadRunSummary(型別加選填 `dodMet?: boolean` 與 `iterationsUsed/maxIterations`)、SubDesign workspace 的 runStatus 呈現,全部讀 deriveRunLifecycle 的輸出,不自行判斷。
- **不做雙向 canonical-state sync**(UI Projection 規範):toast 與補送都是投影端的渲染動作,journal 仍是唯一持久事實。

## Testing Decisions

- 只測外顯行為:給定 journal 狀態與啟動序列,斷言補送 bubble 出現在正確 thread、恰好一次;給定 run registry 的轉移序列,斷言 toast/notify 的觸發與抑制組合;給定 orchestration 快照,斷言 lifecycle label/tone 的終態文案。
- 測試接縫(兩個,皆既有):
  - **runJournal + 啟動復原管線**:`recordRunTerminal` / `reconcileStartup` / `consumeRecoveryReports` 的既有 shipped-module smoke 模式(smoke-caps.mjs 風格,import 真模組)。涵蓋:pending-delivery 補送、once-only、unknown 標注、external 文案。
  - **`deriveRunLifecycle` 純函數**:dodMet=false 的 label/tone/icon 斷言;HITL 仍優先於耗盡語彙。
- Prior art:`smoke-caps.mjs` 的 drift-guard 與 shipped-module import 慣例;`smoke-subdesign-studio.mts` 的 static assertion 風格。禁止在 smoke 內 inline 重寫投遞邏輯(CLAUDE.md 既有禁令)。

## Out of Scope

- Cron / scheduled job 的結果 fan-out 到外部 channel(Telegram 等)——那是 automation 投遞體系,另行處理。
- 補送訊息的重放式完整敘事(tool call 全記錄回放)——補送只帶摘要;深度 replay 屬 fork-and-rerun(harness-gap-closure #02)範疇。
- 通知排程彙整(digest)、安靜時段設定。
- 手機 / 跨裝置推送。
- 變更 Pi Host settlement 協議形狀(只消費既有欄位)。

## Further Notes

- 三斷點來自與 hermes-agent 的對照:其 delegation 有 durable completion queue 與 `unknown` 記法、`notify_on_complete` 有跨畫面到達;AgentTeam 的 evidence/journal 基礎更嚴謹,缺的是把「終點」送到使用者面前的最後一段。方向不是引入新框架,而是把 ADR-0040 journal 從「狀態帳本」升級為「可投遞事件帳本」。
- 與 `.scratch/harness-gap-closure/spec.md` 的關係:那份處理 harness 能力缺口(fork-and-rerun、headless 等),本 spec 只取「終點可到達性」一軸,不重疊其 ticket 範圍。
- 實作順序建議:C(lifecycle 語彙,最小且獨立)→ B(殼層通知)→ A(journal 投遞狀態與補送,涉及啟動序列需最小心)。每步獨立可驗證、可 revert。
