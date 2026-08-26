# 長跑軌跡收口：讓 Turn Record 回看真的可達、真的撐得住長 run

Status: 可交給代理

Source: 第二輪 frontier 對帳對話。turn-record-fidelity 已 resolved，但它留下一個刻意未完成項與一個未答的產品決定（ticket 10 Comments 明載）：視窗虛擬化未做（「需要一次真實的量測 pass，不是一支 smoke」），且 `TrajectoryPanel` 從未被放進任何導覽位置。經查證（2026-08-26）：該元件在 renderer 內**零引用**——分頁協定（`sessions/record` 依 `seq` 定址）、投影（`projectTrajectory`／貼底跟隨／`unloadedBefore` 標記）全部完工並在 smoke chain 上，但使用者沒有任何一條路能打開它。功能偵測失敗即靜默返回 null，所以它連錯都不會報。本 effort 是這個残項的收口 owner。context-usage-panel effort 已明言此項不在其範圍；兩者共用 `InlineRunPanel` 的 PanelSection 容器模式但互不依賴。

## Problem Statement

使用者跑了一個小時的任務，結束後想回答三個問題：「它到底做了什麼」、「它那時在想什麼」、「哪一步最貴」。產品為此建了完整的基礎設施——Turn Record 逐頁可讀、推理全文永在、每步的 token／成本只顯示量測過的數字——但：

1. **入口不存在。** 軌跡檢視元件沒有被掛在任何畫面上。使用者在產品裡找不到任何按鈕、任何頁面能到達它。整個「回看長跑」的故事目前實際上不存在。
2. **長 run 撐不住。** 元件把已載入頁面的每一列都掛上 DOM。載入幾十頁後，捲動與重繪成本線性上升——這是 ticket 10 刻意留下的渲染債，標了 `[~]` 等一次真實量測。

兩件事的共性又是靜默失效：沒有 error、沒有提示，只是使用者要的功能不在那裡。

## Solution

**可達**：執行軌跡成為每個 run 的內嵌檢視的一部分——在既有的 run 面板容器裡新增「執行軌跡」section，沿用現成的面板開啟進入點（run 過程 feed 的 header 微複製模式，與另一個 effort 正在加的「上下文」section 同構）。使用者在任一 run（內建或外部 CLI——兩者的 record 同形）上都能打開它，往回走到最早一步。

**撐得住**：清單改為只掛可見範圍加上少量預備列。窗口計算是純函式：給定有序列、捲動狀態與視窗高度，算出該掛哪一段、上下墊多高。往前載入更早頁面時，使用者閱讀中的那一列停在原位——`seq` 身分本就由既有合併保證，新增的是捲動錨定補償也在同一個純函式裡。

**證明**：在真 app 裡以注入 loader 餵一份幾千列的 fixture 帳本，量測掛載前後的 DOM 節點數與捲動品質，數字寫成證據文件並決定 overscan 預設值。沒有數字就不算完成。

## User Stories

1. As a user whose run just finished, I want to open its execution trajectory from the run's panel, so that 「它剛剛做了什麼」有一個我可以到達的答案。
2. As a user reviewing a long run, I want to walk back to its earliest steps by loading one page at a time, so that一小時前的第一個決定不是產品最先忘記的東西。
3. As a user reading older rows, I want newly arriving rows not to yank my reading position, so that回看不被即時內容打斷。
4. As a user scrolling a very long trajectory, I want the view to stay smooth regardless of how many pages I have loaded, so that審視歷史不會隨長度變成懲罰。
5. As a user who scrolled up mid-review, I want my place kept when an older page prepends, so that「我讀到的那一行」始終是我正在讀的那一行。
6. As a curious user, I want to select any row and see that step's full reasoning, timing and token/cost split, so that「它那時在想什麼」「哪一步最貴」都有答案。
7. As a user inspecting a still-running step, I want it shown as running without a fabricated duration, so that面板永遠不替沒發生的量測編數字。
8. As a user at the very top of history, I want an honest marker of how many earlier entries exist unloaded, so that我不知道的部分被標示而不是被捏造長度。
9. As a user of external CLI runs, I want the same trajectory view with the runner capability declaration visible, so that換 provider 不會掉進一個比較差的舊檢視。
10. As a user in a plain browser, I want the trajectory entry to simply not appear when the Host is absent, so that降級是優雅且誠實的，而非一個壞掉的按鈕。
11. As a maintainer, I want the panel mounted through the same PanelSection container the sibling context panel uses, so that run 內檢視有一種一致的組裝方式而不是每 feature 一套。
12. As a maintainer, I want the window computation as a pure function, so that邊界行為可以在沒有瀏覽器的情況下被窮舉驗證。
13. As a developer, I want row identity keyed by record `seq` end to end, so that prepend、合併與虛擬化任一層都不可能讓既有列換身分。
14. As a developer, I want no second way to build the Pi timeline, so that既有 drift guard 的保證不被這次掛載稀釋。
15. As a developer, I want this work to import nothing from the removable browser loop seam, so that ADR-0045 的邊界保持乾淨。
16. As a maintainer, I want a build-time guard asserting the trajectory panel is referenced by the run panel container, so that「建成但沒人 mount」這個 bug 形態不能悄悄復發。
17. As a maintainer, I want the measurement pass recorded as evidence with real numbers, so that效能主張是量測而不是希望。
18. As a maintainer, I want the `[~]` residual in the closed fidelity effort repointed at this effort when done, so that追蹤器的殘項記錄指向活著的 owner。
19. As a reviewer, I want the overscan default justified by the recorded measurement, so that調整它是重新量測而不是憑感覺。
20. As a user on a modest machine, I want memory bounded by what I asked to load, so that回看一小時的 run 不需要為整份歷史付 RAM。
21. As a maintainer, I want zero protocol changes required, so that這次收口不觸碰 Pi Host Protocol 版本協商。
22. As a user, I want the trajectory section's open state remembered like other panel sections, so that反覆查看不用每次重新展開。
23. As a keyboard user, I want rows reachable and selectable via focus, so that回看不只屬於滑鼠。
24. As a maintainer, I want the entry point hidden rather than disabled when there is no session binding for a run, so that面板只在其語意成立的地方出現。

## Implementation Decisions

**掛載面是既有的 run 面板容器。** 在 `InlineRunPanel` 的 PanelSection 序列裡新增「執行軌跡」section，承載現成的 `TrajectoryPanel`；開啟入口沿用 RunProcessFeed header 的 `onOpenPanel` 微複製模式——與 context-usage-panel 加「上下文」section 的做法完全同構，兩者可並行、互不依賴。不新增導覽頁：回看屬於 run 的脈絡，不屬於頂層導覽。session id 來自該 run 既有之 session binding；無 binding 的 run 不顯示入口（隱藏，非停用）。

**虛擬化是一個新的純函式模組，恰好這一個新接縫。** 輸入：有序的已投影列（含各自近似高度——今日單行 truncate 列高均勻）、捲動位置、視窗高度、overscan。輸出：應掛載的列區間、上方／下方 spacer 高度、以及 prepend 後的捲動錨定補償量（給定補償前使用者可見的首列 `seq`，回傳新捲動位置使同一列留在原位）。元件只消費其輸出，不再自行 `.map` 全部列。選取詳情 footer、載入更早按鈕、錯誤列等非列表元素不虛擬化。

**量測 pass 是人工證據，不是 smoke。** 元件已接受 `loadPage` 注入：以 fixture 帳本（數千列、多頁）在真 app 中量測 before／after 的 DOM 節點數與捲動品質，數字連同環境說明落在本 effort 目錄下，並據此定 overscan 預設。比照 release qualification 的 fail-closed 慣例：證據文件不存在或無數字，最後一張票不得勾。

**防復發 drift guard 一支。** source-text guard 斷言 run 面板容器引用軌跡面板——這次 bug 的形態就是「存在但零引用」。指向擁有者、訊息可行動；掛進既有 smoke chain。

**邊界與既有規則。** Host 缺席（plain browser）時入口不渲染、面板維持 null 返回——ADR-0046 Electron-only、browser 優雅降級。不 import removable browser loop seam（ADR-0045）。零協定變更：分頁讀取與 `recordSummary` 已在位。Pi timeline 的唯一投影來源不變——本 effort 只是把既有投影接到眼睛前面。外部 CLI run 的 record 已含 runner 能力宣告，header 的「未驗證 DoD」標示照舊運作，不需新邏輯。

**收口動作。** 完成後將 turn-record-fidelity ticket 10 的 `[~]` 項更新為指向本 effort 的證據（依 tracker-truth-reconciliation 立下的翻牌規則：純函式 smoke 綠於 gate、drift guard 綠、量測證據在案）。

## Testing Decisions

**What a good test is here.** 只測外部可觀察行為：純函式的輸入輸出、以及「面板被掛載」這個事實本身。不測 React 內部狀態、不測 CSS、不假造 DOM 計數——DOM 節點數屬於人工量測證據，機器只守能確定守的不變量。

**What gets asserted at the new seam（全部決定論、無瀏覽器）。**
- 空 ledger、少於一屏、恰等一屏：不產生空 spacer 或負區間。
- 大 ledger：回傳區間＝可見範圍＋overscan，spacer 高度＝區間外列高總和。
- 捲動跨過閾值：區間平移，且平移前後重疊列的身分（`seq`）不變。
- prepend 錨定：給定補償前可見首列 `seq` 與合併後的新列序，補償量使同一列回到原視窗位置；重疊頁不產生雙倍補償。
- 極端捲動位置（頂、底、越界）不丟例外。

**What gets asserted elsewhere.**
- 掛載事實：drift guard 斷言面板容器引用軌跡面板；反向斷言（移除引用即紅）在守衛自身測試中示範。
- 分頁與投影行為不重測——`smoke-trajectory-paging.mts`（頁邊界：首頁、中間頁、最舊頁、空游標）與 `smoke-live-timeline.mts`（live 與 replay 同一投影）已是 prior art，本 effort 不動它們的斷言。
- 量測證據：人工核對清單（證據文件存在、含 before／after 數字、含 overscan 結論），fail-closed。

**Prior art。** source-text drift guard 房法（frozen renderer seam、second-timeline 禁令、Gate 7 的 KNOWN_UNGATED_TESTS 雙向斷言）；純投影 smoke 模式（`smoke-trajectory-paging.mts`、`smoke-conversation-projection.mts`）；人工證據 fail-closed 模式（`smoke-release-qualification` 的 No-Go）。

## Out of Scope

- **即時串流檢視**：in-run 的過程觀看由既有 live timeline 供應；本 effort 只管事後回看的可達性與效能。
- **軌跡內搜尋、篩選、跳轉到任意 `seq`、匯出**——有用的下一步，另立 effort。
- **`sessions/record` 協定的任何變更**，包括分頁大小與 cursor 語意。
- **SubDesign 的 run inspector** 面板體系——另有自己的容器與慣例。
- **Playwright 完整點擊 smoke**——仍是 INDEX 上的 optional polish。
- **列高動態測量（variable-height virtualization）**：今日列皆單行 truncate；若未來列變高，重開量測再議。
- **context-usage-panel 的「上下文」section**——歸那個 effort。

## Further Notes

- ticket 10 留下的原話是本 spec 的正當性所在：「True windowed virtualization … needs a real measurement pass in the app, not a smoke. Marked `[~]` rather than ticked, so it is not mistaken for done.」以及「**Not wired into a route yet.** … choosing where it belongs in the app's navigation is a product decision rather than part of this ticket.」本 effort 就是那個產品決定的答案：不進導覽，進 run 的內嵌面板。
- 選 `InlineRunPanel` 而非 `ExecutionPage`：前者已是 per-run 檢視的家（sibling effort 同構），後者是另一個頁面層級的表面；把回看放在 run 的脈絡裡符合「Turn Record 是唯一時間線、UI 是投影」的架構敘事。
- 拆票建議：01 純函式視窗模組＋smokes、02 掛載＋入口＋drift guard（01、02 互不依賴可並行）、03 量測 pass＋證據＋trf#10 `[~]` 收口指向（←01+02）。
- 本 effort 完成的判定極簡：**使用者找得到入口，長 ledger 捲起來不卡，而且數字在案。**
