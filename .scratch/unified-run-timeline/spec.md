# Unified run timeline: 推理進 Turn Record，三流收斂為同一有序投影

Status: 已完成

Source：2026-08-25 對話分析「執行中推理摘要／執行訊息／assistant 回應是否有順序性且整合」，對照 `nousresearch/hermes-agent`、`deepseek-ai/deepseek-harness`、`openai/codex` 三方做法。使用者決策：推理完整保留不截斷；右側推理摘要面板改聚焦模式。

## Problem Statement

任務執行中，使用者看到的三樣東西分屬三個互不對齊的表面：推理摘要是一團聚合文字（右側面板、ephemeral、app 重啟即消失）、執行訊息是一張折疊清單（刻意丟棄思考與文字事件）、assistant 回應是另一個聊天氣泡。使用者無法回答「這個工具呼叫之前模型在想什麼」，也無法確認三者的先後關係。

事後的軌跡檢視其實有全序（Turn Record 以 seq 記錄、投影為交錯列），但執行中的呈現走的是另一條活動事件通道（到達序），兩者不同源——live 看到的順序與事後重放的順序沒有一致性保證。

根本原因：模型的推理在 Host 事件流上存在（thinking delta 已經送達活動層），但 Turn Record 寫入點沒有記錄它。這違反了本專案與 deepseek-harness 共同的記錄哲學——「model-visible means logged」：模型說過的思考沒有進記錄，等於從未發生。

## Solution

把 reasoning 變成 Turn Record 的一級 entry：Host 在 turn pipeline 收到 thinking delta 時，與 tool-call、assistant-text 一樣依序寫入記錄（帶 turn/step 歸屬），**完整保留、不截斷**。

對話投影延伸出 reasoning row，與 user/assistant/tool/notice 按 seq 交錯——事後軌跡自動獲得推理。

執行中的 live 時間軸改用與事後相同的投影函數（同一 record 頁），活動事件通道降級為 external CLI（無 Turn Record）runner 的 fallback——live 與 replay 從此同源，codex 的 item 流與 dsh 的 session stream 都是这个原则。

UI 呈現單一時間軸：思考（預設收合、可展開）→ 工具呼叫 → 結果 → 回應交錯；右側推理摘要面板保留但改為聚焦模式——自動捲動聚焦當前 step 的推理，可暫停捲動手動瀏覽。

## User Stories

1. As a 使用者，I want 執行中看到單一時間軸（思考→工具→結果→回應交錯）, so that 我不必在三個面板間來回對照就能理解任務怎麼被完成。
2. As a 使用者，I want 推理預設收合成一行（含字數）, so that 時間軸不被長篇思考推到看不清進度。
3. As a 使用者，I want 展開任一步的推理看當下模型的想法, so that 我能理解每個動作的理由。
4. As a 使用者，I want run 結束與 app 重啟後仍能查看每一步當時的推理, so that 除錯與檢討不依賴當下記憶。
5. As a 使用者，I want 推理完整保留不被截斷, so that 長思考的細節不會無聲消失。
6. As a 除錯者，I want 定位任一工具呼叫之前的推理, so that 我能回答「為什麼它那時決定跑這個指令」。
7. As a 維護者，I want live 與事後使用同一個投影函數, so that 兩種呈現不可能出現不同順序。
8. As a 維護者，I want 舊格式記錄（無推理 entry）照常顯示, so that 升級不破壞既有封存對話。
9. As a 維護者，I want 未知 entry 的優雅降級機制不被破壞, so that 未來新 entry 種類仍能安全上線。
10. As a external CLI 使用者，I want 沒有結構化推理時維持現行活動事件呈現, so that 降級路徑不空白也不壞。
11. As a 審計者，I want 模型可見的思考都在記錄裡（model-visible means logged）, so that 事後稽核有完整依據。
12. As a 審計者，I want 推理 entry 帶 step 歸屬與單調 seq, so that 記錄順序可被機器驗證。
13. As a 使用者，I want 右側推理面板自動聚焦當前 step, so that 長推理進行中我能跟上看的是哪段。
14. As a 使用者，I want 聚焦捲動可暫停, so that 手動回看時不被自動捲動拉走。
15. As a 使用者，I want assistant 回應是時間軸的一部分, so that 「解說→動作→結論」的敘事完整可見。
16. As a 貢獻者，I want 推理投影是純函數, so that live 與 replay 的測試寫法相同。
17. As a 貢獻者，I want drift guard 鎖定 Pi 路徑時間軸的資料來源, so that 未來不會有人把第二套合成邏輯加回來。
18. As a 使用者，I want plain-browser 降級環境行為不變, so that 瀏覽器模式不是二等公民。

## Implementation Decisions

- **Turn Record 新增 `reasoning` entry kind**：`{ kind: 'reasoning', source: 'model', turn, step, seq, content }`。Host 端 turn pipeline 在收到 message update 的 thinking delta 時 append；seq 單調、step 歸屬與同 step 的 tool-call 一致。**完整保留不截斷**——不做 per-entry 截斷、不做單 turn 總量上限；體積後果由既有的 bounded paging（翻頁載入）與 compaction 機制服務，這是已批准的取捨。
- **對話投影延伸**：conversation projection 新增 `reasoning` row kind，按既有 seq 順序與其他 row 交錯；trajectory projection 因為複用同一投影，自動獲得 step/timing 歸屬。未知 entry 降級為 notice 的既有機制不動，舊記錄（無 reasoning entry）投影結果必須與現行完全一致。答案推導語意不變——最後一則 assistant row 仍是答案，reasoning 不參與答案選擇。
- **Live feed 同源化**：Pi Host run 的執行時間軸改由 Host 的 live Turn Record 頁投影（與事後同一投影函數）；活動事件通道（thought/text/tool/status）保留，但只服務沒有 Turn Record 的 runner（external CLI）作為 fallback，語意不變。Pi 路徑不得再從活動事件合成時間軸——以 drift guard 鎖定。
- **UI 單一時間軸**：執行中呈現思考（收合列，顯示字數，展開看全文）→ 工具 → 結果 → 回應的交錯流；assistant 的進行中草稿屬於時間軸的當前 assistant 列。右側推理摘要面板改聚焦模式：自動捲動跟隨當前 step 的推理，使用者手動捲動即暫停跟隨、可回到當前。
- **不變的鄰居**：Outbound Data Gate、Approval 決策、finalization、runQueue、UI Projection 唯讀原則全部不動。compaction 對 reasoning entries 的處理沿用既有 compaction 行為，策略另案。

## Testing Decisions

好的測試只驗外部可觀察行為：投影輸出的列順序與內容、記錄的 seq 單調性、fallback 的觸發條件——不窺探內部實作。本專案以 smoke 為測試，必須 import 出貨模組，禁止 inline 重實作。

- **純投影函數直接驗證**：conversation projection 的 reasoning row（交錯順序、字數、向後相容——舊記錄輸出與現行一致）。Prior art：既有的 conversation projection smoke。
- **Host 記錄層**：turn record completeness smoke 延伸——thinking delta 依序進記錄、seq 單調、step 歸屬正確、完整保留無截斷。Prior art：既有的 turn record / step timing smokes。
- **Live=replay 同源**：同一 record 頁餵投影函數兩次（模擬 live 與事後），輸出必須逐列一致。Prior art：trajectory paging smoke 的純投影慣例。
- **Drift guard**：鎖定 Pi 路徑 live timeline 的資料來源必須是 record 投影（仿既有契約檢查風格，指向新 owner 而非弱化）。
- **Fallback 語意**：external CLI（無 Turn Record）路徑的活動事件呈現維持現行——feed context isolation smoke 保持綠。

## Out of Scope

- External CLI runner 的結構化推理（provider 不提供就沒有，fallback 已涵蓋）。
- 推理的編輯、刪除、或部分遮蔽 UI。
- Compaction 對 reasoning entries 的專門策略（沿用現行 compaction，另案）。
- 右側面板中 tasks／file changes 等其他資訊的去留（僅推理摘要改聚焦模式）。
- 推理的跨 run 搜尋（session_search 整合，另案）。
- 任何對 legacy loop seam 的新參照（ADR-0045 刪除閘門）。

## Further Notes

- Host 端其實已經看得到 thinking delta（活動層已映射），本 spec 的記錄層工作是「把既有資料流接進寫入點」，不是新資料來源——這是成本主要落在接線與驗證的原因。
- 推理完整保留會放大 journal 體積；既有 bounded paging 已被驗證可投影 45+ operation 的 turn，這是體積取捨可被接受的前提。
- codex 的 item 流（reasoning 為一級 item）、hermes 的 transcript 順序重插、dsh 的「model-visible means logged」是本 spec 三個外部先例；本專案 Turn Record 架構與 dsh 同源，缺的只是 reasoning 這一種 entry。
