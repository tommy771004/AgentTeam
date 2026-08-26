# 執行中 run 的重新附著（Active Run Reattachment）

> 狀態：`可交給代理`

## Problem Statement

renderer 重新載入時，正在執行的 run 會從畫面上消失，然後被記成一個從未發生的中斷。

Pi Core Host 跑在 Electron main 監督的 utility process，`turn/submit` 是 main 端 `piHostSupervisor` 持有的長命請求。renderer 死掉不會殺掉這個 turn——Host 繼續思考、繼續呼叫工具、繼續寫 Turn Record。但 renderer 是用 `ipcRenderer.invoke` 等這個結果的，context 一銷毀，那個 promise 就沒有人接了：Host 照常算完，回覆落進虛空。

於是新的 renderer 起來時：

- 執行時間軸是空的。`recordEntries` 只是 renderer 看過的 ephemeral tail，沒有任何流程會去把 Host 已經寫下的部分抓回來。
- `reconcileStartup()` 把所有 `admitted` / `running` / `dispatching` 的 journal entry 標成 `interrupted`——它假設 renderer 的死亡等於 run 的死亡。**這個假設是錯的**，所以 journal 對一個仍在跑的 run 說了謊。
- finalization 從未執行：沒有摘要氣泡、沒有正確的 terminal 標記、沒有 Archive、沒有容量釋放。
- 使用者看見「沒在跑」，於是重送一次。容量計數活在 renderer 記憶體裡，也跟著 renderer 一起消失了，所以**第二個 run 會對同一個 thread 開始執行，而第一個還在 Host 裡跑**。

ADR-0039 早就規定了正確行為：「after renderer reload or Host restart, the client obtains a snapshot and resumes events after a cursor」。CONTEXT.md 對 **UI Projection（UI 投影）** 的定義也已經寫著「rebuilt from a snapshot plus events after a cursor」。這條契約寫下來了，但沒有實作。本 effort 不改變執行或結算的歸屬，只是把已經決定的事做出來。

## Solution

Pi Core Host 為每個 run 保留一份 **attachment record**：狀態、Turn Record 的 high-watermark、以及不可逆的 execution settlement——terminal record 保留到 renderer 明確 acknowledge 或有界 TTL 到期，所以 renderer 不在時結果有地方落地。Electron main 只 relay，不保存第二份 lifecycle truth。renderer 啟動時先訂閱、再取 snapshot、最後依 `seq` 把訂閱期間緩衝的事件合併進來，重建同一條 UI 投影，接著繼續收更新、可以要求取消，並把 Host terminal outcome 恰好一次交給既有 app finalization。

合併與結算判斷抽成一個純模組：吃 snapshot、緩衝事件、generation 與已觀察的 high-watermark，吐出協調後的 entries、缺口回報、以及該不該結算。所有競態（重複、亂序、過期世代、快照與 live 重疊、terminal 競跑）都變成 fixture 而不是計時測試；真實時序另由一條重啟 e2e 覆蓋。

`reconcileStartup()` 不再對還活著的 run 說謊：它先問「誰還在跑」，只把查不到的 run 標成 interrupted。

## User Stories

1. As a task conversation user, I want a run that is still executing to still be on screen after the app window reloads, so that I do not think my work vanished.
2. As a task conversation user, I want the reattached timeline to show the reasoning, tool calls and results that happened while I was away, so that I can catch up on what I missed rather than only seeing what comes next.
3. As a task conversation user, I want the reattached timeline to be in the same order as the one I was watching before, so that live and reattached views cannot disagree about what happened first.
4. As a task conversation user, I want a run that finished while the renderer was down to still produce its summary bubble, so that a completed run is never silently lost.
5. As a task conversation user, I want to be told when the app is reattaching rather than seeing an empty panel, so that I can tell "reconnecting" from "nothing is running".
6. As a task conversation user, I want to be able to cancel a reattached run, so that regaining the view also regains control.
7. As a task conversation user, I want a cancellation to stay pending until the Host acknowledges it, so that the button never claims a stop that has not happened.
8. As a task conversation user, I want a late provider success that arrives after I cancelled to leave the run cancelled, so that a run I stopped cannot come back to life.
9. As a task conversation user, I want a run to settle exactly once no matter how many times the renderer restarted, so that I never see a duplicate summary, duplicate metrics, or a duplicate archived transcript.
10. As a task conversation user, I want the app to refuse to start a second run for a thread whose first run is still executing in the Host, so that a reload cannot silently double my work and my spend.
11. As a task conversation user, I want capacity to be restored on reattachment, so that the concurrency cap still means something after a reload.
12. As a task conversation user, I want a run that was waiting on my approval to still be waiting after a reload, so that a reload does not auto-deny work I meant to allow.
13. As a task conversation user, I want same-thread follow-ups to stay ordered across a reload, so that a queued message is not overtaken by the run it was queued behind.
14. As a task conversation user, I want other threads to keep running independently while one thread reattaches, so that recovery in one conversation does not stall the others.
15. As a user who reloads near the end of a run, I want the Host to have kept the terminal result until someone collects it, so that finishing at the wrong moment does not lose the outcome.
16. As a user whose run genuinely died with the app, I want it marked interrupted as before, so that honest interruption reporting is not lost to the new recovery path.
17. As a user reattaching to a very long run, I want a bounded snapshot rather than the whole history, so that recovery does not stall or exhaust memory.
18. As a user reattaching to a run whose earliest entries the Host no longer retains, I want the gap stated rather than hidden, so that I am not shown a shortened history as if it were complete.
19. As a developer, I want an older reconnect response that resolves after a newer one to be discarded, so that stale data cannot overwrite the current view.
20. As a developer, I want overlapping snapshot and live entries deduplicated by sequence, so that reattachment cannot double-render what I already have.
21. As a developer, I want the observed high-watermark to be monotonic, so that a backfill of old entries is never counted as new activity.
22. As a developer, I want retryable transport failure to stay distinct from terminal run failure, so that a dropped connection does not read as a failed run.
23. As a developer, I want reattachment to be pure observation, so that recovering a view can never invoke a second model turn or bypass the coordinator.
24. As a maintainer, I want every race case expressed as a fixture rather than a timing test, so that the regressions stay deterministic.
25. As a maintainer, I want reattachment to reuse the Turn Record sequence rather than a parallel event vocabulary, so that there is still one timeline.
26. As a maintainer, I want renderer code to feature-detect the reattachment bridge, so that the plain-browser degrade keeps working.
27. As a security-conscious user, I want raw connector credentials to stay out of renderer state during recovery, so that reattachment does not widen the blast radius.

## Implementation Decisions

**已決：Pi Core Host 是 attachment truth owner。** Ticket 01 已選 B，完整理由與上界見 [`decision.md`](decision.md)。Pi Core Host journal 保存 active／terminal attachment metadata；Turn Record 仍是同一份 Host session record。main 的 `piHostSupervisor` 只持有 transport pending request 與 renderer subscription，不建立第二份可獨立演進的 attachment truth；renderer 仍是 disposable UI Projection。

**Protocol v3。** Attach／ack／active-run query 是 Pi Host Protocol 的 versioned contract，不是 main-only 私有 IPC。依 ADR-0038 由 v2 升到 v3，更新 negotiation、shared types 與 protocol smoke。這不新增 ADR：ADR-0039 已明定 Host canonical 與 snapshot + cursor；也不把 ADR-0040 的 automation queue record 混成 attachment record。

**其餘已確認的決定**

- **測試形狀：純協調模組 + 真實重啟 e2e，兩者都做。** fixture 證明每個競態下的邏輯正確，e2e 證明真實時序下整條路徑接得起來；兩者互補。
- **只處理 renderer 重啟。** main／Host process 重啟不在範圍內。

**Attachment record。** 為每個 `runId` 在 Pi Core Host 保留：目前狀態（active / terminal 的分類）、`sessionId`／`threadId`／turn identity、Turn Record 的 `latestSeq` high-watermark、不可逆的 Pi execution settlement、bounded terminal summary、以及 acknowledgement 狀態。`turn/submit` 的結果先寫進這份 record，再回覆當初 invoke。active 保留到 terminal；terminal 到 ack 或 24 小時 TTL，硬上限 256 筆；summary 最多 64 KiB。清理不逐出 active record。record 不含 prompt、完整工具輸出或 raw credentials，且不複製 Turn Record entries。

**attach / ack / active query 介面（feature-detected）。** Attach 回傳「有界 snapshot + cursor 之後的 ordered events」，ack 冪等釋放 terminal retention，active query 供 bootstrap／startup reconcile。Snapshot 每次最多 200 entries，帶 `latestSeq`、`total`、`availableFromSeq` 與明確 gap，不用「少了幾筆你自己算」。renderer 一律 `window.subagents?.piHost` 偵測；main／preload 只做 typed relay。

**訂閱先於 snapshot。** 先註冊 listener 並緩衝，再取 snapshot，最後依 `seq` 合併——否則 snapshot 請求與 listener 註冊之間會有 startup gap。研究文件已經指出這一點，照它做。

**純協調模組。** 輸入 snapshot、緩衝事件、generation、已觀察的 high-watermark；輸出協調後的 entries、新的 high-watermark、缺口、是否過期、以及該不該結算。合約與 `liveTimeline` / `conversationProjection` / `projectContextUsage` 同族同純度：no I/O、no store、no clock、no randomness。排序只看 `seq`。**沿用 Turn Record 的 sequence，不發明第二套事件詞彙。**

**Generation guard。** 每次重新附著遞增 generation；較舊的 read 或 stream 結果在 generation 不符時全部作廢。`TrajectoryPanel` 既有的 request-generation guard 是同一個模式，形狀要對齊而不是各寫一套。

**High-watermark 單調。** `recordTotal` 改由 snapshot 的 `total` / `latestSeq` 校準，取 monotonic max；不再用「本次 buffer 新增幾筆」累加，否則 backfill 會被當成新事件而膨脹。

**兩層 settlement，各自只有一個 owner。** Pi execution settlement 只由 Pi Core Host 決定並先寫 journal；terminal 後不可被 late event 改寫。重新附著是**觀察與協調**，不是第二個 ingress：它不呼叫 `dispatchThreadTask`、不呼叫 `startExecution`、不觸發第二次 model turn。它只把 Host terminal outcome 交回 `taskRunCoordinator` 既有的 unique app finalization，冪等完成 summary／afterRun／Archive／`onSettled`／release／drain。既有的 finalize-idempotency 保證要延伸到「原 renderer 的 finalizer 與重啟後 renderer 的協調競跑」這一案。

**容量與 registry 重建。** 重新附著必須以 Host active query 把 run 放回 renderer run registry 投影並重新佔用容量；bootstrap reconciliation 完成前，新的 admission fail closed／等待。否則 reload 之後 `maxConcurrentRuns` 形同虛設、同 thread 也可能開出第二個 run。這是 story 10/11 的實作位置。

**Cancel 語意不變。** 取消維持 `cancel_requested` 直到 Host ack；terminal 之後抵達的 late success 不得把 cancelled／failed 改回成功。這是既有語意，重新附著只是要在跨 renderer 實例時仍然成立。

**Retryable ≠ terminal。** transport 層的重連失敗與 run 的終局失敗必須是不同的東西，UI 不得把前者顯示成後者。

**`reconcileStartup()` 改為先問再標。** 目前它無條件把 active 狀態標成 `interrupted`。改成：先取得 Pi Core Host 仍認得的 active／terminal attachment 集合；active 不標 interrupted，terminal 交給 app finalization，只有兩者都查不到的才標 interrupted。Host bridge 不可用（plain browser、bridge 缺席）時維持現行行為——那個情況下 renderer 的死亡確實等於 run 的死亡。

**Journal 的角色。** renderer `runJournal` 維持 local-first 的**投遞追蹤**用途（`pending-delivery` / `consumed` 那套不動）。它不是重新附著的真相來源；真相來自 Pi Core Host attachment journal 與同一 Host 的 Turn Record。兩者的分工要寫進模組註解，避免下一個人以為 renderer journal 是權威。

**UI 最後做。** 先證明生命週期正確，再加畫面。重新附著中的狀態、缺口告知沿用既有 Turn Record 投影與既有 design token，不新增第二個進度來源、不新增假百分比。

## Testing Decisions

**好的測試只驗外部行為。** 餵 fixture 進純模組，斷言輸出的 entries、high-watermark、缺口、過期判定與結算決策；不驗內部實作、不驗呼叫次數。

**兩層驗證，互補而非重複。**

1. **純協調模組（新接縫）。** 比照 `smoke-live-timeline` / `smoke-context-usage-projection` 的 fixture 模式（no Electron、no store、no DOM），新 smoke 掛進 `smoke` 鏈，並比照既有投影 smoke 加上原始碼禁用斷言（`Date.now` / `Math.random` / zustand / 動態 import / `window.`）作為純度 drift guard。每個競態都是 fixture，快而且穩。
2. **真實重啟 e2e。** 對真實 Pi Host 起 run，執行中途銷毀並重建 renderer。fixture 看不到的東西在這裡驗：訂閱時機、IPC 生命週期、保留與 ack、容量重建。比照既有 `smoke-pi-electron-host-e2e.mjs`，不新增第二套 e2e 框架；至少覆蓋「tool 執行中重啟」與「Host terminal append 之後、finalization 之前重啟」兩個時點。必須等可觀察狀態而非固定 sleep，連跑數次不得 flaky。

**既有 smoke 延伸，不新增檔案：**

- `smoke-finalize-idempotency` — 加「原 renderer finalizer 與重啟後協調競跑，仍只結算一次」。
- `smoke-run-completion-reachability` — 加「renderer 在 Host terminal append 之後、finalization 之前重啟，結果仍然到得了使用者」。
- `smoke-run-journal-durability` / `smoke-run-journal` — 加「`reconcileStartup` 不再把 Pi Core Host 仍認得的 active run 標成 interrupted，且 Host terminal attachment 走 app finalization」。
- `smoke-run-lifecycle` — 加重新附著後的 lifecycle 相位。
- `smoke-live-timeline` — 加「snapshot 與 live 重疊時，合併後的投影與從未斷線的投影逐列相同」。
- `smoke-steer-enqueue-fallback` — 加「跨 reload 的同 thread 佇列順序不變」。

**競態不用計時測試。** 每一個競態（快照/live 重疊、亂序、重複、過期世代、terminal 競跑、late success）都以 fixture 表達，不靠 sleep 賭時序。真實時序由上面第 2 層的 e2e 覆蓋。

**保留既有基線。** `npm run build`、`npx oxlint src`、完整 `npm run smoke` 必須維持全綠；既有 drift guard 只能加強不能放寬。

## Out of Scope

- **main／Host process 重啟與機器重開。** Pi child 隨父程序而死，in-flight turn 目前無法跨越；那需要 on-disk 的 in-flight 持久化與可續跑的 Pi child，是另一個 effort。這些情況下 `reconcileStartup` 標 interrupted 是**正確的**，維持現狀。
- **`runResume`（parked run 續跑）。** 那是用續跑目標開一個**新的** run，與附著到**仍在執行**的 run 是不同的問題，本 effort 不動它。
- **External CLI runner 的重新附著。** 本 effort 只處理 Pi Core Host 路徑；external CLI 有自己的 supervision policy 與 durable harness。
- **Pi Host Protocol v3 以外的無關 protocol 重構。** 本 effort 只加入 attach／ack／active query 與必要 negotiation；不趁機改造其他 method。
- **TrajectoryPanel 的視窗虛擬化。** 是 `turn-record-fidelity` 既有的刻意未完成項。
- **新的進度呈現或百分比。** 沿用既有 Turn Record 投影。
- **跨裝置／跨機器的 run 接續。**

## Further Notes

- **本 effort 不改變執行或 app finalization 的歸屬**，因此不需要新 ADR。ADR-0039 已經指定 Host 為權威、renderer 為可拋棄投影並規定 snapshot+cursor 續傳；本 effort 是它的實作。依 ADR-0038，Pi Host Protocol 由 v2 升到 v3。若實作過程中發現必須新增第二個 coordinator 或移動結算歸屬，**先寫 ADR 再動工**（handoff 的設計性質 10）。
- CONTEXT.md 對 **UI Projection（UI 投影）** 的定義已經寫著「rebuilt from a snapshot plus events after a cursor」——這個詞彙已經存在，本 effort 讓定義成真。文件與 issue 一律使用 glossary 的詞：Task run、Loop run、Chat turn、Pi Core Host、UI Projection、Execution evidence。
- 研究成果在 `.scratch/run-progress-lifecycle/research.md`，其中的 reconnect 演算法（先訂閱 → 取 snapshot → generation 相同才安裝 → 依 seq 合併）與六項差距排序是本 spec 的依據，不在此重述。
- 現行 worktree 刻意是 dirty 的，含使用者自有變更；**不得 reset、覆蓋或大範圍重排**。
- UI 文案維持 Traditional Chinese mixed with English 慣例。

## Tickets

| # | Ticket | Blocked by |
|---|--------|-----------|
| 01 | [決定重新附著的真相歸屬](issues/01-truth-owner-decision.md) | — |
| 02 | [reattach 純協調模組 + smoke](issues/02-reattach-projection.md) | — |
| 03 | [attachment record + 終局保留](issues/03-attachment-record.md) | 01 |
| 04 | [attach / ack 介面 + preload](issues/04-attach-ipc-surface.md) | 03 |
| 05 | [renderer bootstrap 重新附著 + 容量重建](issues/05-renderer-bootstrap-reattach.md) | 02, 04 |
| 06 | [跨 renderer 實例的冪等結算](issues/06-idempotent-settlement.md) | 05 |
| 07 | [`reconcileStartup` 先問再標](issues/07-startup-reconcile-truth.md) | 04 |
| 08 | [cancel / terminal 競態](issues/08-cancel-terminal-races.md) | 06 |
| 09 | [重新附著的 UI 呈現](issues/09-reattach-presentation.md) | 05 |
| 10 | [真實重啟 e2e](issues/10-real-restart-e2e.md) | 06 |
| 11 | [qualification](issues/11-qualification.md) | 01–10 |

**開工順序**：01 已 resolved。02 可立即開始；03 → 04 → 05（同時依賴 02）→ 06，之後 07／08／09／10 可並行，11 收口。
