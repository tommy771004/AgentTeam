# 韌性語意與能力補齊:對照 hermes-agent 的五個 harness 缺口

> 狀態:`ready-for-agent`(無 issue tracker,以此欄位代替)
> 來源:2026-08-23 session — AgentTeam vs github.com/nousresearch/hermes-agent 任務執行機制對照
> 詞彙:CONTEXT.md(Chat turn / Task run / Task run coordinator / Execution evidence / UI Projection);ADR-0040(durable journal)、ADR-0042(replay-safe checkpoints)、ADR-0045(`agent/loop` 為可移除 seam)、ADR-0048(model cannot manufacture execution evidence)
>
> **與既有 spec 的關係**:接續 `.scratch/harness-gap-closure/spec.md`(17 tickets,架構敘事/工具/治理面)與 `docs/specs/run-completion-reachability.md`(終點事件可到達性)。G4/G5 與 harness-gap-closure 01、04 有領地重疊,本文以 Hermes 對照得出的語意重新表述;實作時若該 spec 的 ticket 已動工,以其為準、本文讓位。

## Problem Statement

把本產品的任務執行 harness 與 hermes-agent(NousResearch)逐項對照後,結論是:我們在「正確性與收斂」上更嚴謹——單一入口 coordinator、不可偽造的 execution evidence、統一的 lifecycle 投影詞彙——但在「韌性語意」上落後。韌性缺口不是獨立的,而是一條斷鏈的三環:

1. **Turn 無法安全中斷(G1)。** Pi Host 的 `turn.submit` 沒有 explicit timeout,也沒有 AbortSignal 穿透到執行層。一個卡死的 turn 只能等 settlement 或整個殺掉 utility process;abort 能力只存在於已被 ADR-0045 判定的遺留 loop(`engine.ts` 的 `this.aborted`)。hermes-agent 的每次 API 呼叫都跑在 interruptible call 內——timeout、使用者輸入、`/stop`、signal 都能 mid-stream 中斷,且部分回應不污染歷史。
2. **中斷了無法續傳(G2)。** 目前的恢復是「事後重建」而非「續傳」:renderer 重整靠 session snapshot + cursor 重放事件;compaction checkpoint 只存 localStorage(LRU 5 個 run、quota 失敗降級只留摘要),不是權威儲存。hermes-agent 把 session 持久化在 SQLite(FTS5 全文可搜),重啟自動載入 history,並有 Idempotency-Key 保證跨請求不重複。
3. **Context 撐不久只能截斷(G3)。** 現有 `contextPruning.ts` 是三層截斷(keepLastNRounds → soft-trim → hard-clear placeholder),沒有摘要式 compaction,也沒有 preflight 觸發點(接近 context 上限時主動壓縮)。長 run 到後段會失去早期脈絡,且截斷是無聲的——使用者不知道 agent 已經「忘了」。hermes-agent 用可插拔 context engine 做 lossy 摘要,preflight >50% 即觸發,壓縮前先 flush memory 防資料遺失。

另外兩項是清理與能力補齊:

4. **雙軌 loop 並存(G4)。** `agent/engine.ts`(816 行)+ `agent/loop/loopRunner.ts` 與 Pi Core 生產路徑並行。ADR-0045 已定調遺留路徑可刪、禁止新 import,但刪除門檻未過——兩套執行語意(如 abort 只有遺留側有)是 drift 的溫床。
5. **記憶體系缺位(G5)。** compaction checkpoint 是防災快照,不是知識沉澱;沒有跨 session 的 memory 層,也沒有 skill 化的程序累積。hermes-agent 有三層:有界 MEMORY/USER 檔 + FTS5 session 搜尋 + skill 自建自修(curator 定期評分合併)。本專案已有 learning loop 草稿(harness-gap-closure #04 要給它檔案寫入路徑),但缺少「什麼值得記」的沉澱機制。

## Solution

把 G1→G2→G3 當成一條鏈依序補齊,每環都可獨立 revert:

1. **Abortable turns(G1)**:在 Pi Host 協定加上 per-turn timeout 與 abort 語意——submit 時可帶 AbortSignal 句柄,Host 側收到 abort 後在下一個 tool boundary 安全停車,settlement 回 `interrupted`,已產生的部分輸出照常投影到 feed(不宣稱完成,沿用 ADR-0048 誠實終態語意)。
2. **Durable checkpoints(G2)**:compaction checkpoint 與 run journal 從 localStorage 升級到主進程權威儲存(沿 ADR-0040 journal 的既有持久化路徑),去掉 LRU/容量降級;配合 G1 的 interrupt settlement,interrupted run 可從最後 checkpoint 續跑,而不是只能重放或放棄。
3. **Summary compaction with preflight(G3)**:在截斷層之上加摘要式 compaction——當 run 接近 context 上限(preflight 檢查),先對早期 turn 做保留要點的摘要替換,壓縮前先把關鍵事實寫入 run journal(checkpoint 快照涵蓋壓縮前原文);UI Projection 上,被壓縮的事實以一行可展開的標記呈現,使用者知道「前面有內容被收納了」。
4. **Delete the legacy loop(G4)**:滿足 ADR-0045 的刪除門檻後移除 `agent/engine.ts` + `agent/loop/`,abort/timeout 只存在於 Pi Host 一處。前置條件:G1 完成且 smoke drift guard 改指向新 owner(呼應 harness-gap-closure #01/#05)。
5. **Run-level memory sink(G5)**:run 收尾(finalization)時,把「值得留下的事實」(objective、關鍵決定、失敗原因、可重用程序)寫成 thread 可見的沉澱摘要,並落到專案檔案路徑(與 harness-gap-closure #04 的 skills 寫入路徑同一去處);後續同 thread 的新 run 以此為前情提要。

## User Stories

1. As a 使用者, I want 我送出的長任務有明確的時間上限, so that 卡死的任務不會永遠佔著一條 thread
2. As a 使用者, I want 我能主動中止一個跑偏的任務, so that 不用等它跑完或殺掉整個 app
3. As a 使用者, I want 中止後畫面顯示的是「已中斷」與已完成的部分輸出, so that 我知道哪些工作真的發生了
4. As a 使用者, I want 中止一個任務後可以從斷點繼續而不是從頭再來, so that 長任務的中途修正不需要付出全部成本
5. As a 使用者, I want app 更新或重啟後 interrupted 的任務仍可續跑, so that 維護視窗不毀掉進行中的工作
6. As a 使用者, I want 同一次續跑不會被重複觸發兩次, so that side effects(發信、寫檔)不會加倍
7. As a 非技術業主, I want 「已中止」與「失敗」在畫面上是不同的說法, so that 我知道哪個是我自己按停的
8. As a 使用者, I want 超長任務自動整理前面的脈絡而不會突然忘記目標, so that 一小時的任務和一分鐘的任務一樣可靠
9. As a 使用者, I want 被收納的前段內容有一個看得到的標記, so that 我知道 agent 不是憑空接續
10. As a 審計需求的使用者, I want 壓縮前的完整原文有留存, so that 事後可查證 agent 當時看到了什麼
11. As a 開發者維運者, I want abort/timeout 只存在於一條執行路徑, so that 我不用維護兩種中斷語意
12. As a 開發者維運者, I want 遺留 engine 移除後 build 與 smoke 仍然全綠, so that 刪除是安全的
13. As a 使用者, I want 每次任務結束後留下「學到了什麼」的沉澱, so that 同類型的下一次任務不用重新踩坑
14. As a 使用者, I want 新任務開始時自動帶入同 thread 的前情沉澱, so that 對話是有記憶的而不是每次歸零
15. As a 團隊協作者, I want 沉澱的知識落在專案檔案裡可 commit, so that 經驗可以在同事間流動
16. As a 非技術業主, I want 沉澱摘要是人話而不是內部術語, so that 我讀得懂 agent 學到了什麼
17. As a 使用者, I want timeout 的長度合理且可在設定調整, so that 不同類型的任務有不同的耐心額度
18. As a 使用者, I want 中止操作立即有回饋(spinner 停止、狀態列更新), so that 我確定按鈕真的生效了

## Implementation Decisions

- **G1 — Abortable turns**:abort 是 Pi Host 協定層的能力,不是 renderer 的 fire-and-forget。submit 回傳一個 abort 句柄;Host 在 tool boundary(不在 tool 執行中途硬切)停車;settlement 語意擴增 `interrupted(timeout)` 與 `interrupted(by user)` 兩種成因。timeout 由 taskRunCoordinator 在 admission 時依 runner/pattern 決定預設值,thread 設定可覆寫。部分輸出的投影規則:已抵達 renderer 的 delta 保留,未完成的 text delta 以中斷標記封口。
- **G2 — Durable checkpoints**:checkpoint 與 journal 的持久化搬到主進程(與 ADR-0040 journal 同一儲存層),localStorage 版本刪除不做相容層(AGENTS.md:不留 fallback)。resume 入口走 `taskRunCoordinator.runTask`(唯一 ingress 不變),以 replay-safe checkpoint(ADR-0042)保證 side effects 不重放;無法證明 side effect 未發生的 run,fail-closed 拒絕 resume 並如實告知。
- **G3 — Summary compaction**:compaction 是 pruning 之後的第二道閘——先截斷舊 tool result,超出閾值才做摘要替換。preflight 觸發點設在每個 turn 送出前檢查估算 token 量。壓縮器以介面注入,預設實作用現有 LLM provider;壓縮事件本身寫入 run journal(何時壓、壓了哪些範圍)。UI Projection 增加 compaction marker 這一種 item kind。
- **G4 — Legacy loop removal**:嚴格依 ADR-0045 門檻,不另立新標準。刪除順序:先改指 smoke drift guards → 移除 UI 對 engine 的殘餘引用 → 砍檔。這一步不可與 G1~G3 同一 PR(revert 邊界隔離)。
- **G5 — Run-level memory sink**:finalization 時由 Host 側生成沉澱摘要(objective/decisions/failures/reusable procedure 四段),經既有 projectBridge 檔案寫入路徑落到 `<project>/.subagents/memory/`;thread 內新 run admission 時注入最近 N 份沉澱作為前情提要。模型不得直接宣稱已沉澱——以 journal 記錄的寫入證據為準(ADR-0048 延伸)。
- 所有新程式碼禁止 import `agent/loop/*`(ADR-0045 既有規則)。
- 不引入 SSE/WebSocket;傳輸層維持 IPC + typed events,與 Pi Core 架構一致。

## Testing Decisions

- 只測外部行為:從 `taskRunCoordinator.runTask` 與 Pi Host 協定邊界驅動,不測內部 reducer/私有函式。
- G1:submit 後觸發 abort → 斷言 settlement 成因正確、feed 封口標記存在、journal 有 terminal 記錄;timeout 用假 clock 驅動。
- G2:kill-and-restart 情境——checkpoint 後殺掉 Host,重啟 resume,斷言 side-effect 工具不被重放(以 execution evidence 計數);斷言 localStorage 路徑已不存在。
- G3:超量 context 輸入 → 斷言 preflight 觸發、journal 有壓縮事件、UI Projection 出現 compaction marker、壓縮前原文可從 checkpoint 取回。
- G4:刪除後全 smoke 通過;新增 source-text drift guard 斷言 repo 內無殘餘 import。
- G5:run 完成 → 斷言沉澱檔案落盤、四段結構完整、下一次 run 的 prompt 含前情提要;模型宣稱但無寫入證據的情境必須 fail。
- Prior art:`scripts/smoke-caps.mjs`(import 真模組 + architectural drift guards)是本倉庫認可的測試形態;`smoke.mjs` 的 inline re-implementations 是反面教材(harness-gap-closure #05 正在修)。

## Out of Scope

- 跨平台 gateway(Hermes 的 Telegram/Discord 等多 surface 投影)——本產品只有 desktop renderer surface。
- Provider fallback 鏈與 credential pools——已有 `llmResilience` circuit breaker,本次不重構。
- FTS5 式全文 session 搜尋——G5 先落檔案,搜尋介面另案。
- Cron scheduler 的改造(既有 ScheduledJob 機制不動)。
- Subagent/delegation orchestration(本產品的 multi-agent 模型另行演化)。

## Further Notes

- 對照研究的完整證據在本 session 的分析紀錄:Hermes 端的 interruptible call、SQLite SessionStore、context_engine lossy compaction 是三個被借鑑的機制名稱,僅供實作時查閱原設計,不代表要移植其程式碼。
- G1→G2→G3 有依賴順序(resume 需要 interrupted settlement;compaction checkpoint 需要 durable storage 才有意義);G4、G5 可平行。
- 每一步的 revert 邊界 = 一個獨立 ticket + 獨立 PR;G4 明確要求不可與其他步驟混雜。
