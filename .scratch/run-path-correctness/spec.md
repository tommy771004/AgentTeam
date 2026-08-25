# Run-path correctness: steer 不丟訊息、prompt 去重、vision 保留、finalization 冪等

Status: 可交給代理

Source：2026-08-25 對 SubAgents AI 與 `nousresearch/hermes-agent`、`openai/codex` 的三方原始碼比較分析（邏輯錯誤與優化、功能缺口、重複 request 與資料三軸）。本規格收錄其中四項高影響執行路徑缺陷的修復。

## Problem Statement

使用者在一個 run 忙碌時送出轉向（steer）訊息，可能同時失去兩樣東西：前一個任務被中止了，但新的目標卻沒有被執行也沒有入隊——畫面上還留著「已轉向」的系統氣泡，使用者的指示憑空消失。

每一次對話都會把當前請求的原文重複注入模型 prompt 兩次（一次經近期對話歷史、一次經「當前請求」段落），使用者為同樣的 token 付雙倍成本，且重複文字會輕微偏移模型注意力。外部 CLI 路徑已有去重守衛，builtin 與 Pi Host 路徑沒有。

在含圖片的對話中，一旦觸發上下文壓縮，所有圖片都被替換成 `'[image]'` 佔位符——連壓縮機制刻意逐字保留的近期訊息也不例外。模型中途失去全部視覺證據，視覺工作流在長對話中不可靠。日誌甚至記下「transcript 含影像無法壓縮」，實際行為卻照壓不誤。

最後，若 finalization 在中途拋出例外（例如已寫 journal、已通知 onSettled，但尚未釋放容量），外層 catch 會從頭再執行一次整段 finalization：thread 上出現重複的失敗氣泡、journal 寫入兩次、scheduler/webhook 結算被觸發兩次。機率低但爆炸半徑大，且違反本專案「唯一 finalization」的不變量精神。

## Solution

**Steer 永不丟失目標。** 使用者轉向時，若前一個 run 在有限等待窗口內無法停下來（安全停靠停在工具邊界是正常行為，不是錯誤），新目標自動走既有的佇列機制排隊，thread 上顯示的是如實的狀態（「已中止並排入佇列」），而非謊稱已完成轉向。只有在前一個 run 根本無法中止時才允許回報 busy。

**當前請求只注入一次。** 三條執行路徑（Pi Host、legacy builtin、external CLI）共用同一個歷史組裝守衛：若歷史尾端的 user 訊息就是本次請求原文，組裝歷史時先切除，再由「當前請求」段落單獨承載它。

**壓縮不再摧毀圖片。** 上下文治理器把未經破壞的原始訊息交給壓縮器；純文字化只發生在被摘要的舊段落內部。非溢出情境下含影像的 transcript 保持原狀；即使溢出必須壓縮，刻意保留的近期訊息中的圖片原樣保留。「含影像無法壓縮」的日誌與實際行為一致。

**Finalization 冪等。** Finalization 取得 per-run 冪等宣告；同一 run 的第二次 finalization 是 no-op。任何中途例外都不會導致結算、封存、onSettled 或容量釋放被執行兩次，容量槽保證最終釋放。

## User Stories

1. As a 使用者，I want 轉向訊息在上一個任務停不下來時自動排入佇列, so that 我的指示永遠不會因為 busy 而消失。
2. As a 使用者，I want thread 上的系統氣泡如實反映轉向結果（已接手／已入佇列第 N 位）, so that 我不會誤以為新任務正在執行。
3. As a 使用者，I want 轉向前一個任務的部分進度摘要保留在氣泡中, so that 中止的代價可以被看見與評估。
4. As a 使用者，I want 只有在前一個 run 確實無法中止時才收到 busy 回覆, so that busy 是真實狀態而非競速失敗的藉口。
5. As a 自動化操作者，I want schedule / webhook / telegram 來源的 follow-up 遵循同樣的不丟失語意, so that 自動化流程不會靜默掉訊息。
6. As a 使用者，I want 每則訊息的內容只出現在 prompt 的一個位置, so that token 成本與模型注意力不被重複文字浪費。
7. As a 使用者，I want builtin、Pi Host、external CLI 三條路徑對「當前請求」的組裝語意一致, so that 切換 runner 不會改變模型的上下文認知。
8. As a 維運者，I want prompt 去重守衛集中在一處共用實作, so that 未來新增 runner 時不會遺漏或複製出第四份邏輯。
9. As a 使用者，I want 長對話中的圖片在壓縮後仍然存在於近期訊息裡, so that 視覺任務（截圖審查、設計比對）不會在中途失效。
10. As a 使用者，I want 非必要時（非溢出）含影像的 transcript 完全不被壓縮, so that 壓縮只在我同意的成本換取下發生。
11. As a 除錯者，I want 日誌如實描述壓縮決策, so that 「含影像無法壓縮」代表真的沒有壓縮。
12. As a 視覺工作流使用者，I want 被摘要的舊段落允許降為文字佔位, so that 壓縮仍能省 token，只是不在保留段上省。
13. As a 使用者，I want finalization 中途失敗時 thread 只出現一個終態氣泡, so that 我不會看到矛盾的雙重結果。
14. As a 維運者，I want scheduler 與 webhook 的結算每個 run 恰好觸發一次, so that 下游自動化（通知、發布）不重複觸發。
15. As a 使用者，I want 失敗的 finalization 之後我的並行容量一定被釋放, so that 一個壞 run 不會永久佔住槽位讓後續任務全部 busy。
16. As a 審計者，I want run journal 每 run 至多一筆 terminal 記錄, so that 事後稽核不會遇到同一 run 的兩份矛盾結局。
17. As a 維護者，I want finalization 的冪等性由型別或宣告機制保證而非依賴呼叫端自律, so that 未來新增入口時不可能繞過。
18. As a 貢獻者，I want 這些修復各自有對應的 smoke 驗證出貨路徑, so that 重構移動程式碼時守衛會跟著指向新 owner 而非默默失效。
19. As a 使用者，I want 以上行為在 plain-browser 降級路徑同樣成立, so that 瀏覽器模式不是二等公民。
20. As a 維護者，I want 修復不引入任何對 `agent/loop/` 的新參照, so that ADR-0045 的刪除閘門不被推遲。

## Implementation Decisions

- **Steer 分支改造（task run coordinator admission 層）**。現行實作在 `stopExecution` 後以固定 20×50ms 輪詢等待容量，逾時即回 `skipReason: 'busy'`。改為：窗口耗盡且容量未釋放時，改走既有的 external-run 佇列入隊路徑（與 queue 政策同一機制，含 dedupe key 與位置回報），回傳 `queued` 結果；僅當根本不存在可中止的 busyRunId 時允許回 busy。系統氣泡文案依實際結果分流：「已轉向」（容量確實釋放、新目標接手）、「已中止前一任務，新目標已排入佇列第 N 位」、「無法中止前一任務」。中止前摘要（partial digest）在三種分支都保留。
- **Prompt 去重守衛收斂為單一共用 helper**。External CLI 路徑已實作「尾端 user 訊息等同本次 raw 目標則切除」的守衛；將該語意提取為 chat-history 組裝層的單一 helper，Pi Host turn-context 建構與 legacy builtin 路徑改呼叫他。比對語意維持現行 CLI 版本：role 為 user 且內容完全相等（不做模糊比對，避免誤刪相似但不同的訊息）。附件情境：帶附件的 user bubble 內容若與 objective 相等仍適用切除（附件另行準備，不受影響）。
- **Vision compaction 重構資料流（context governor beforeRound）**。現行先將全部訊息 flatten 為純文字再餵給 compact，壓縮產物整體替換 live transcript。改為：(1) `compact` 收到未破壞的原始訊息陣列；(2) 純文字化（image part → `'[image]'`）只發生在被摘要捨棄的舊段落在壓縮器內部；(3) transcript 含影像且非 overflow 情境時，跳過 parity 觸發的壓縮，原樣返回；(4) overflow 情境仍壓縮，但壓縮器刻意保留的近期訊息必須原樣通過（含 image parts）；(5) 「含影像無法壓縮」日誌只在真的跳過壓縮時記錄。governor 現有的注入式 deps 介面（contentToPlainText / compact）維持不變，這是本次修復所依賴的測試接縫。
- **Finalization 冪等宣告**。Finalization 入口取得 per-run 冪等宣告（模式仿既有 capacity registry 的宣告集合）：宣告成功才執行，重複呼叫直接 no-op 返回首次結果。外層 catch 仍保留作為最後防線，但因冪等宣告而不會二次執行結算鏈。容量釋放（releaseRunCapacity）從「finalization 序列中的一步」提升為「無論序列成敗皆由冪等持有者保證執行」的義務——可用 try/finally 包裹整段序列達成。早終（early finalization）路徑與正常路徑共用同一宣告機制。
- **不改動的鄰居**。Approval 決策順序、Outbound Data Gate、trigger fail-closed 驗證、runQueue 的 FIFO+dedupe+上限語意、UI Projection 的唯讀原則全部不動。本規格是執行路徑正確性修復，不是 context 架構重構——穩定前綴分層（stable→context→volatile）另案處理。
- **文件同步**。CLAUDE.md 的 Busy policy 段落補一句 steer 逾時的入隊 fallback 語意，避免規格與指引漂移。

## Testing Decisions

好的測試只驗外部可觀察行為（回傳值、journal 記錄數、氣泡存在性），不窺探內部狀態或實作細節。本專案無 unit-test runner；smoke 就是測試——必須 import 出貨模組本身，禁止 inline 重實作，禁止為了 import 加 loader 依賴。

- **Seam 1（主接縫）：task run coordinator admission**。Steer 行為在此最高點驗證：以可注入/可模擬的 capacity 與 stop 行為重現「停不下來」情境，斷言結果為 queued（含佇列位置）、thread 出現如實氣泡、objective 進入佇列而非被 skip。Finalize 冪等同樣在此驗證：令 finalization 序列在中途拋錯後再次觸發，斷言 journal terminal 記錄、onSettled、容量釋放各恰一次。Prior art：既有對 coordinator 生命週期不變量的 drift-guard smokes。
- **Seam 2（次要接縫）：context 組裝邊界**。(a) Governor：透過既有 deps 注入假的 contentToPlainText 與 compact，餵含 image parts 的 transcript，斷言非溢出時原樣返回、overflow 時保留段含原始 image parts、被摘要段降為純文字。(b) Prompt 去重：直接呼叫共用 helper 與 Pi turn-context 建構器，斷言尾端 objective 相等的歷史被切除、不相等時保留。Prior art：contextGovernor 既有以注入 deps 測試的 smoke 慣例。
- **Drift guards**：為「三條路徑都必須呼叫共用去重 helper」加 source-text drift guard（仿既有契約檢查），防止第四條路徑或複製貼上繞過。

## Out of Scope

- Context 組裝的穩定前綴分層重構（stable→volatile 排序、prompt cache 友善化、cached tokens 觀測）——另案。
- hermes/codex 比較中列出的功能缺口（smart approval、OS 原生沙箱、多 agent 原語、web search、OTEL 等）。
- localStorage 全庫持久化的 debounce/per-thread 化（效能優化，非正確性）。
- Scheduler 雙 tick 源的冗餘掃描去除（已驗證無雙觸發風險）。
- Egress profile cache 的 LRU 化與 key 衝突整治。
- Token 估算熱路徑的 TextEncoder 提升等微優化。
- 任何對 `agent/loop/` 的新功能或新引用（ADR-0045 刪除閘門）。

## Further Notes

- 四項修復彼此獨立，可分票平行進行；唯一共享檔案是 task run coordinator（steer 與 finalize 兩票需注意合併順序）。
- Steer 語意變更屬於行為修正而非新功能：現行「回 busy 但其實已中止前一任務」在任何合理讀法下都是 bug，不需 feature flag。
- Prompt 去重的效益可直接度量：修復前後同一 thread 連續兩 turn 的 prompt 字元數差應下降約一個 objective 的長度。
- Vision 修復須確認 OpenCode compaction 對「保留段逐字原樣」的既有承諾（其設計明確保留最近訊息不動），governor 不得再破壞該承諾。
