# Agent runtime 深化：六個測試性／安全性缺口收斂

Status: resolved

## Problem Statement

`/improve-codebase-architecture` review 掃過上週 Phase 0–5 grok-build 落地的區域（`toolLoop.ts`、`engine.ts`、`toolGuard.ts`、`executor.ts`、task-run coordinator 群、settings）後，接續一輪 `/grilling` + `/domain-modeling` 拷問，在六個地方發現同一種病的不同病徵：載重邏輯（security-load-bearing 或資料完整性攸關）散在多處、只靠人工記得同步，而僅有的測試是手抄原始碼字串的鏡像——鏡像不會因為真正的邏輯漂移而變紅。

具體風險：

1. 核准決策的 9 層判斷散在 `authorizeTool` 內、跨 5+ store 動態 import，唯一測試是 `smoke-caps.mjs` 手抄的鏡像。
2. 47 個工具的 catalog／關鍵字／參數／owning capability 散在 4 個檔案，「每個工具至少屬於一個 capability」沒有任何機制強制——啟發式執行路徑上，沒有 capability 的工具會靜默繞過核准。
3. 約 170 行的 token 估算／自動壓縮／checkpoint／memory flush／recall 內聯在工具迴圈中段，`compactionCheckpoint.ts` 零測試覆蓋。
4. `engine.ts` 的 function-calling、heuristic、simulation 三條步驟執行路徑各自重複 capability 組裝與「核准→執行→限流→記錄→afterTool hook」收尾，parity 靠一行註解維持——目前 heuristic 路徑執行 connector／plugin 自訂工具時完全跳過 `afterTool` hook，這個缺口沒有任何測試會抓到。
5. Settings 的 79 個欄位中至少 14 個需要客製 deep-merge 語意，`mergeSettings` 的手抄清單沒有機制強制同步，忘記新增會靜默遺失使用者資料。
6. 兩輪已完成的 task-run 遷移把 `runExternal.ts` 掏空到只剩型別、一個 OpenCode 專屬 helper、與兩個零呼叫者的相容函式，但檔案還在，且既有 smoke 對它的 54 處字串斷言裡，至少一處因為 `.ts` 副檔名的正則疏漏而假性通過，完全沒抓到 coordinator 其實動態拉回了這個「legacy」檔案。

若不收斂，這些縫會持續讓「測試綠燈」跟「行為正確」脫鉤——尤其 1、2、4 三處直接涉及核准與 hook 是否真的觸發，屬於信任邊界問題，不只是程式碼整潔問題。

## Solution

六個獨立、範圍機械可界定的內部重構，每個把載重邏輯抽到一個窄介面後面，用**真 import** 測試取代手抄字串鏡像。除了兩個明確判定為「觀測缺口而非決策語意」因而**主動修正**的項目（heuristic 路徑 custom 工具的 `afterTool` hook 缺口；settings merge 完整性）之外，全部行為 bit-for-bit 保留，外部呼叫端簽章一律不動。

三次針對 Claude Code 桌面版公開文件的對標研究驗證了方向：持久化狀態該用「重新注入」而非原地變異、效果該拆成獨立可替換的關注點（採用於 #2）；所有工具呼叫不分來源都該走同一條 authorize→execute→hook 管線，沒有文件記載的例外（採用於 #3，並確認 heuristic 的 hook 缺口是異常而非可援引的設計選擇）。

## User Stories

**Approval Decision（#1）**

1. As a 開發者, I want the full 9-layer approval decision sequence to live in one pure, directly-testable function, so that I can verify its exact ordering without reaching into 5+ stores via dynamic import.
2. As a reviewer, I want a real import-based test suite for the approval decision sequence, so that a hand-copied mirror can no longer silently diverge from the production code it claims to protect.
3. As a security-conscious maintainer, I want the existing precedence guarantees (hook deny beats everything including full-access mode; capability-declared approval survives full-access) preserved bit-for-bit, so that this refactor introduces zero behavior change to a security-load-bearing path.
4. As a 開發者, I want the bash-allowlist-clears-prior-ask quirk preserved and documented (not silently fixed), so that intentional behavior is not mistaken for a bug in a future pass.
5. As an operator relying on hook-driven audit trails, I want all deny paths — including the three that previously skipped it — to emit a `permissionDenied` observability event, so that denial-ratio metrics are not systematically undercounted.
6. As a caller of the approval guard's existing entry points, I want their external signatures to remain completely unchanged, so that neither of the two existing call sites requires modification.

**Tool Definitions（#4）**

7. As a 開發者 adding a new tool, I want a single record to hold its catalog entry, keyword hints, parameter schema, and owning capability, so that adding a tool takes two edits instead of four.
8. As a security reviewer, I want it to be a compile error for a tool to exist without an owning capability, so that a tool can never silently ship ungated on the heuristic execution path.
9. As a 開發者, I want the tool name type to be derived from the single record's keys, so that the tool name union and the record can never drift apart.
10. As a maintainer, I want the existing per-tool execution switch statement left untouched, so that this refactor does not risk large I/O dispatch code for what is fundamentally a data-modeling problem.

**Context Governor（#2）**

11. As a 開發者, I want the inlined compaction/checkpoint/memory-flush/recall logic extracted behind one governor interface, so that the checkpoint module's zero test coverage becomes testable via fakes.
12. As a 開發者, I want the governor's effectful dependencies (compaction, checkpoint save, memory flush/recall, hook evaluation, metrics, notification, logging) injected rather than dynamically imported inside the governor, so that tests can substitute fakes without touching module-loading machinery.
13. As a maintainer, I want the governor instance's per-round usage-bucket state to reset every step (not persist across a whole Loop run), so that the existing "each step's context meter starts fresh" behavior is not accidentally changed.
14. As a 使用者 relying on partial-failure tolerance, I want each of the six post-compaction effects (hook eval, checkpoint, memory flush, message swap, memory recall, metrics+hook+notify) to remain independently fault-isolated, so that one failing effect cannot silently swallow the others.
15. As a 開發者, I want the notification effect currently called directly inside the compaction block to become an injected dependency, so that no compaction-related side effect bypasses the governor's dependency boundary.

**Step Executor（#3）**

16. As a 開發者, I want the function-calling, heuristic, and simulation step-execution strategies to share one input/output interface, so that adding step-level behavior doesn't require touching three separate inline implementations.
17. As a 開發者, I want the capability/preload/blocked-tools assembly logic computed once and shared by both the function-calling and heuristic strategies, so that the two can no longer independently drift.
18. As a 使用者 of a connector or plugin tool under the heuristic execution path, I want an after-tool-call lifecycle hook to fire for my tool exactly as it already does for built-in tools and for every tool under the function-calling path, so that hook-driven audit/notify rules apply consistently regardless of which execution strategy served my step.
19. As a 開發者, I want the heuristic-to-simulation fallback on LLM failure to remain owned by the step orchestrator (not by either strategy adapter), so that no adapter needs to know its siblings exist.
20. As a maintainer, I want the shared post-execution tail (payload enforcement, call record, hook firing) to stay scoped to only the tool kinds the heuristic path actually touches (built-in and custom tools), so that MCP/delegate/framework-tool handling — exclusive to the function-calling path — is not forced into a shape it doesn't need.
21. As a reviewer, I want the step orchestrator's external method signature and its existing internal call sites to remain unchanged, so that this refactor is provably internal-only.
22. As a 開發者, I want it to remain architecturally clear that the heuristic strategy executes tools in a single fixed pass while the function-calling strategy loops across multiple rounds, so that no future change tries to force both into an artificial shared "loop" abstraction.

**Settings Manifest（#5）**

23. As a 開發者 adding a new object- or array-typed settings field, I want a test to fail if I forget to add merge handling for it, so that a forgotten field can no longer silently lose persisted data on the next settings patch.
24. As a maintainer, I want this enforcement to be a lightweight, test-time completeness check rather than a full type-level restructuring of the settings interface, so that the fix is proportionate to a data-loss risk rather than a security-bypass risk.
25. As a 開發者, I want the list of fields requiring custom merge handling to be an explicit, exported, single source of truth, so that both the merge function and its test read from the same list.

**Retire runExternal（#6）**

26. As a 開發者, I want the two-way circular type dependency between the task-run policy module and the legacy compatibility module resolved, so that the canonical task-run types live in a neutral location neither module has to reach backward for.
27. As a maintainer, I want all dead code in the legacy compatibility module (an uncalled compatibility function and an unused re-export block) removed outright, so that no one mistakes it for still-needed migration surface.
28. As a 開發者, I want the OpenCode session-mapping helper relocated to the OpenCode-specific module where its sibling helpers already live, so that it is no longer stranded inside a file being deleted.
29. As a reviewer, I want the existing drift-guard test that currently passes only because of a file-extension mismatch in its regex to be corrected, so that it actually enforces the "coordinator does not reach back into legacy code" invariant it was written to protect.
30. As a maintainer, I want the legacy compatibility file deleted entirely once nothing real remains in it, so that the coordinator is unambiguously the single lifecycle owner with no residual shell to accidentally re-populate.
31. As a 開發者 relying on the existing lifecycle drift-guard suite, I want all existing assertions currently keyed to the legacy file's text rewritten to check the new locations, so that historical Phase 3 invariants stay enforced rather than silently deleted along with the file.

**跨候選**

32. As a product owner, I want none of these six refactors to change any user-facing product behavior except the two explicitly identified fixes (heuristic hook-skip gap; settings merge completeness guard), so that this work carries no release-risk beyond its own test suite.

## Implementation Decisions

**通用原則**：所有六項都是內部重構，外部呼叫端簽章一律不動；除非明確判定為「觀測缺口」，否則決策語意 bit-for-bit 保留；六項皆不需要 ADR（三條門檻——難逆、無 context 會意外、真取捨——沒有一項全部滿足，皆為可逆的內部重構）。

**#1 Approval Decision**：把 `authorizeTool` 現行 9 層判斷中的前 8 層（plan mode、policy、bash 段級、capability approvalTools、hooks、forceAsk、mcpWrite 啟發式、unattended/full-access 降級）全部收進一個純函式 `decide()`；第 9 層（HITL ask）與所有效果（notify/metrics/log）留在既有 guard 層。`decide()` 採「效果即資料」——回傳 `{ verdict, reason, logs[], events[], askSpec? }`，呼叫端負責真的發送。bash 段級判斷所需的 resolver 以函式形式作為 `decide()` 的輸入（呼叫端閉包 agent id 與既有模組層級水合狀態）。兩個既有怪癖：bash 段級 allow 清除先前 policy ask 的行為——bit-for-bit 保留；三類 deny（sub-agent gate／blockedTools／SubDesign gate）先前不發送 `permissionDenied` 事件——這是觀測缺口，修正為與其他 deny 路徑一致都發送事件。新詞條「Approval Decision」已寫入 `CONTEXT.md`（本輪 session 已完成，非本 spec 待辦）。

**#4 Tool Definitions**：47 個工具的 catalog 說明、關鍵字提示、參數 schema、owning capability 合併成一個資料紀錄，工具名稱型別由此紀錄的 keys 導出（單一來源）。既有的 catalog／參數／capability 工具清單全部改為從這個紀錄導出的視圖，呼叫端零改動。每工具恰好一個 owning capability 升格為型別強制不變量——遺漏或打錯字是編譯錯誤。既有的逐工具 execute switch 保留原樣，只加一個窮盡性檢查防止新增工具忘記處理執行分支。

**#2 Context Governor**：一個工廠函式建立 governor instance，每次「單一步驟的工具迴圈」呼叫建立一個新 instance（不是每個 Loop run 一個——現行的每輪使用率門檻狀態本來就是每個步驟重新歸零，新介面必須維持這個生命週期，不能不小心讓它跨步驟累積）。governor 的主要方法在每一輪工具迴圈開始前呼叫,輸入含當前訊息陣列、輪次、可用工具、設定與執行識別資訊,回傳（可能經過壓縮處理的）新訊息陣列——原本的原地清空/重建訊息陣列的寫法,改成回傳新陣列由呼叫端重新賦值。所有真正的效果（實際壓縮呼叫、hook 評估、checkpoint 寫入、記憶 flush/recall、metrics 累加、通知發送、日誌輸出）都是注入依賴,不在 governor 內部動態 import——包含一個先前直接呼叫、繞過依賴邊界的通知效果,這次也收進依賴清單。壓縮觸發後的六個效果（hook 評估、checkpoint、記憶 flush、訊息替換、記憶 recall、metrics+hook+通知）維持各自獨立的錯誤隔離,不合併成單一外層錯誤處理——現行行為就是任一效果失敗不擋其他效果,這個粒度必須保留。純數學型的估算輔助函式（token 估算、context window 解析、觸發門檻判斷）維持原樣直接呼叫,不必包裝成注入依賴。一個命名怪癖被記錄但不修正：目前「壓縮前」事件實際上是在壓縮動作已經確定發生之後才觸發,語意上更接近「壓縮確定發生、寫入 checkpoint 之前」。

**#3 Step Executor**：三條步驟執行策略（function-calling、heuristic、simulation）收攏到一個共用的輸入／輸出介面後面。步驟編排器（今天的步驟執行主流程）保留步驟前置（safety gate、model 能力降級判斷、vision 圖片降級）與步驟後置（confidence、Definition of Done 判斷、狀態更新）於自身,只有「取得步驟輸出」這一段透過策略介面分派——三條策略的內部形狀本來就不同構（function-calling 是多輪迴圈、heuristic 是單次固定清單、simulation 完全無工具）,介面不強迫它們共用迴圈結構,只統一輸入輸出。兩個真正可共用的邏輯抽成獨立的匯出函式（不是介面方法）：capability／preload／blocked-tools 組裝邏輯抽一份,function-calling 與 heuristic 兩條策略呼叫同一份而非各自重新組裝;「核准之後 → 執行 → 限流 → 記錄 → afterTool hook」的收尾邏輯抽一份共用,只涵蓋 heuristic 路徑實際碰到的工具種類（內建工具與 custom／connector 工具）,不涵蓋 MCP、delegate、框架工具（這些是 function-calling 專屬,維持原樣不動）。heuristic 路徑執行 custom 工具時跳過 `afterTool` hook 的既有缺口,在改用共用收尾邏輯後自然修正——經對標 Claude Code 公開文件確認,所有工具來源觸發相同 hook 待遇沒有例外,這個缺口屬於異常而非設計。LLM 呼叫失敗時 heuristic 策略退回 simulation 策略的 fallback,由步驟編排器自己擁有（try 呼叫 heuristic、catch 後改呼叫 simulation）,任何策略 adapter 不需要知道其他策略的存在。

**#5 Settings Manifest**：現行 `mergeSettings` 對 14 個物件／陣列型別欄位的手抄特例清單,抽成一個匯出常數（單一來源）。不做型別層的全面重構（例如把整個 settings 介面改造成逐欄位標註合併策略的紀錄型別）——這個問題的後果是資料被覆蓋遺失,不是安全繞過,規模對不上大改造的成本。

**#6 Retire runExternal**：legacy 相容檔案裡僅存的兩塊真實內容——canonical 的執行請求／結果型別、與一個 OpenCode session 對照 helper——分別遷移到一個中性的既有型別模組（避免在兩個「canonical」模組之間造出新的循環型別依賴）與既有的 OpenCode 專屬模組（該 helper 邏輯上屬於那裡）。檔案裡的死碼（零呼叫者的相容函式、無人使用的再匯出區塊）直接刪除,不經過棄用期。完成遷移後,legacy 檔案整個刪除。

## Testing Decisions

**測試哲學**：好的測試觀察外部可觀察結果——呼叫次數、傳入參數、回傳值、状態變化——不斷言私有資料結構或原始碼字串本身。現行多處測試是讀取原始碼檔案當字串、用正則比對特定片段是否存在（本 session 稱為「手抄鏡像」）——這類測試在原始邏輯搬遷或修改後會產生假陰性或假陽性（本次已具體驗證一例：一條斷言「coordinator 不可動態 import legacy 模組」的正則因為副檔名疏漏,在 coordinator 其實已經這樣做的情況下仍然通過）。六項工作全部以真 import 測試取代對應範圍內的手抄鏡像,鏡像未涵蓋的既有測試不動。

**鎖定強度,兩級**：決策相關欄位（verdict、reason 分類、events 種類與數量、呼叫次數、關鍵參數如「拿到的是壓縮前還是壓縮後的訊息陣列」）精確比對；日誌字串只鎖 level 與關鍵字子字串,不做全字串相等——文案調整不應該讓测试變紅。

**各項覆蓋**：

- **#1**：新測試套件涵蓋——hook deny 贏過一切（含 full-access）；capability 宣告的核准在 full-access 下仍生效；bash 段級 allow 清除先前 ask 的既有怪癖；unattended 時 full 降級為 auto；unattended + side-effect 一律 ask；mcpWrite 啟發式強制 ask；三類先前不發事件的 deny 現在事件種類與數量逐項比對。
- **#4**：驗收即編譯——遺漏 owning capability、參數缺漏、capability id 打錯字皆為建置期錯誤；既有測試確認導出視圖行為不變。
- **#2**：新測試套件涵蓋——固定輪次觸發壓縮的節奏公式；溢位風險強制壓縮；含圖片附件時跳過壓縮且不呼叫壓縮依賴；壓縮發生時九個效果依序呼叫、checkpoint 收到的是壓縮前而非壓縮後的訊息；只有 pruning 沒有壓縮時只有訊息替換、其餘效果不觸發；使用率門檻日誌只在跨門檻時觸發；六段效果的獨立錯誤隔離——其中一個丟例外不影響其餘效果執行；兩個獨立 governor instance 的門檻狀態互不影響。
- **#3**：新測試套件涵蓋——capability／preload 組裝邏輯用同一組輸入分別模擬兩條策略呼叫,結果完全相等；共用收尾邏輯對內建工具與 custom 工具都確認 hook 真的被呼叫（custom 工具這一條就是缺口本身的回歸鎖定）；payload 超量截斷行為；heuristic 策略端到端測試；simulation 策略的決定性輸出；LLM 失敗時編排器正確 fallback 到 simulation 且例外不外洩；function-calling 策略的轉呼叫薄層驗證（不重複既有覆蓋）。
- **#5**：新測試案例對預設 settings 值逐一檢查——凡值為物件或陣列型別的欄位,斷言其存在於合併特例清單中。
- **#6**：既有針對 legacy 檔案的字串斷言,全部改為讀取新落點並重新比對相同意圖；先前因副檔名疏漏而假性通過的斷言改用不受副檔名影響的寫法,確認真正抓得到殘留引用；刪除檔案後,檢查死碼是否還在的斷言直接移除（檔案不存在本身就是更強的保證）。

**共同驗收關卡**：`npm run build`、`npm run smoke`（含六個新增/擴充的測試案例）、`npx oxlint src` 全綠；每一項另外要求人工逐段核對新模組與被取代的既有內聯邏輯是否語意對齊——測試矩陣是第一道防線,code review 是最終防線。

**Prior art**：既有 `smoke-caps.mjs`／`smoke-scenario-e2e.mjs`／`smoke-platform.mjs` 的真 import 測試案例（非鏡像部分）、`task-run-coordinator-deepening` 與 `execution-trust-hardening` 兩份已完成 spec 建立的 production-module pure-helper 測試慣例。

## Out of Scope

- 產品面可見行為變更——除了本 spec 明確列出的兩個修正（heuristic 路徑 custom 工具的 `afterTool` hook 缺口；settings merge 完整性檢查）之外,不引入任何新行為。
- 把壓縮／checkpoint／記憶做成通用可插拔框架或對外 SDK 介面——本次 grilling 已明確判定為過度工程,governor 只是內部可測 orchestration。
- 統一 function-calling 與 heuristic 兩條策略的迴圈／輪次結構本身——兩者迴圈語意本來就不同構,只有工具執行收尾與 capability 組裝該共用,不包含把 heuristic 也改造成多輪迴圈。
- 把 `LlmSettings` 整個改造成逐欄位型別強制的合併策略紀錄——規模與這個問題的風險等級不成比例。
- MCP 工具支援、delegate/background job 生命週期變更、任何框架工具（plan mode、tool_search、load_capability）行為變更——這些維持 function-calling 路徑專屬,本次不觸碰。
- 任何一項的 ADR——六項全部評估過三條門檻,沒有一項達標,不開 ADR。
- 重新開放 ADR-0003 並行預設、`task-run-single-owner-cleanup`／`task-run-coordinator-deepening` 已完成範圍、或本 spec 之外的任何既有已完成/待審閱工作。

## Further Notes

- 本 spec 的來源：`/improve-codebase-architecture` 架構審查（範圍鎖定在上週 Phase 0–5 grok-build 落地區域）→ `/grill-with-docs`（`/grilling` + `/domain-modeling`）拷問 session,横跨 21 題決策,六個候選全數達成共識。
- 三次針對 Claude Code 桌面版公開文件的對標研究（僅使用官方文件,非猜測）分別驗證了：持久化狀態「重新注入」優於原地變異、效果拆成獨立可替換關注點（用於 #2 的決策）；所有工具呼叫不分來源走同一條 authorize→execute→hook 管線,沒有文件記載的例外,且 heuristic 的 hook 缺口屬於異常而非可援引的設計（用於 #3 的決策）。
- `CONTEXT.md` 的「Approval Decision」詞條已在本輪 session 內寫入（隨附 #1 的決策同步結晶）,是本次 session 已完成的既有工作,不在本 spec 待辦範圍內,但尚未 commit——後續執行第一項 ticket 時一併確認。
- 建議的 ticket 拆分：六張,一個 seam 一張,編號 01–06,每張的檢查清單取自對應的 Testing Decisions 小節。
