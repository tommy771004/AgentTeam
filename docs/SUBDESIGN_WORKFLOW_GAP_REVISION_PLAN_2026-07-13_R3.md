# SubDesign 建立設計工作流程 × 頁面跳轉：第三輪比對與修改計畫書（實作追蹤）

> 日期：2026-07-13（第三輪）
> Open Design 分析版本：**本輪重新 `git clone` 最新 `main`**，commit [`d4762a9522618339b00c1aa084e59a25ca26a0ca`](https://github.com/nexu-io/open-design/tree/d4762a9522618339b00c1aa084e59a25ca26a0ca)（2026-07-13），比先前三份文件引用的 `4567a0d`（2026-07-12 左右）新。
> SubAgents AI 比對基準：目前工作區完整狀態（含所有未 commit 變更）。
> 範圍與前三份文件的差異：`docs/SUBDESIGN_OPEN_DESIGN_ANALYSIS_2026-07-13.md`、`docs/SUBDESIGN_OPEN_DESIGN_INTEGRATION_PLAN.md`、`docs/SUBDESIGN_WORKFLOW_GAP_REVISION_PLAN_2026-07-13(.md/_R2.md)` 已把 brief / direction gate / design system 注入 / artifact manifest / critique evidence / export / memory 等**業務邏輯**逐項核對到很細的程度，結論多為「已完成」。本輪改用使用者這次特別點名的角度重新查證：**使用者在「開始建立設計 → 過程 → 結束」時，畫面實際怎麼跳轉、URL 怎麼變化**——這個維度先前三份文件只在最舊的 `SUBDESIGN_OPEN_DESIGN_ANALYSIS_2026-07-13.md` 提過一次（列為 P1「流程斷裂」），R1/R2 沒有再逐項核實它是否真的修好。**本輪直接讀原始碼逐行追蹤，發現它其實沒有修好，且比原始描述更嚴重。**

> 實作狀態（2026-07-13）：R3-P1～R3-P5 已完成。R3-P5 已依 `nexu-io/open-design` source code 對齊「brand sources → Design System Studio」handoff；本文件第 3、4 節保留實作前的比對證據，第 7、8 節記錄本輪完成後的驗證結果。

## 1. 為什麼要再做一輪

上一次使用者問「有沒有需要做什麼」時，我原本想只核實 R2 宣稱的「已完成」項目。使用者選擇「其他」並要求**重新讀 open-design 原始碼**、**重新比對 workflow 與頁面跳轉**、**產出新的修改計畫書**。因此本輪：

1. 重新 clone open-design（非讀取先前文件片段），確認其 client-side router 與各頁面元件的目前實作。
2. 直接讀 SubAgents AI 目前工作區的 `SubDesignPage.tsx`、`App.tsx`、`RunSummaryCard.tsx`、`threadStore.ts`，逐行追蹤一次「使用者按下建立設計」到「看到成品」之間，URL 與畫面實際怎麼變化——不採信舊文件裡「已修復」的結論，自己重新 grep 驗證。
3. 只對**業務邏輯**（bash 閘門、evidence 驗證、export 保真度等）維持 R2 的結論，不重複验证；本輪焦點集中在頁面/路由層。

## 2. Open Design 的頁面路由模型（本輪實測，`apps/web/src/router.ts`）

Open Design 的 web app 是 **client-driven SPA**：Next.js 只有一個 catch-all route（[`apps/web/app/[[...slug]]/page.tsx`](https://github.com/nexu-io/open-design/blob/d4762a9522618339b00c1aa084e59a25ca26a0ca/apps/web/app/%5B%5B...slug%5D%5D/page.tsx)）渲染 `<ClientApp />`，實際路由完全由 [`apps/web/src/router.ts`](https://github.com/nexu-io/open-design/blob/d4762a9522618339b00c1aa084e59a25ca26a0ca/apps/web/src/router.ts) 這個手寫的 tiny router 決定（刻意不用 react-router，因為「we want a single source of truth for *what file is open*」）。

它的 `Route` union 只有幾種 kind，但**每一種都刻意做成 deep-link 化**：

| Route kind | URL 形狀 | 對應畫面 |
|---|---|---|
| `home` | `/`、`/projects`、`/automations`、`/plugins`、`/design-systems`、`/library`、`/integrations`、`/onboarding` | Home 殼層的分頁（不同 tab，同一元件） |
| `design-system-create` | `/design-systems/create` | 獨立的多步驟精靈（brand 萃取 / DESIGN.md 建立） |
| `design-system-detail` | `/design-systems/:id` | 單一 design system 的詳情頁 |
| `project` | `/projects/:id`、`/projects/:id/files/<path>`、`/projects/:id/conversations/:cid`、`/projects/:id/conversations/:cid/files/<path>` | **Studio**：一個設計專案的完整生命週期 |
| `marketplace` / `marketplace-detail` | `/marketplace`、`/marketplace/:id` | Plugin 市集 |

`navigate()`／`goBack()` 是唯一的導航入口，統一管理 `history.pushState`／`odIndex` 深度，讓瀏覽器上一頁/下一頁行為正確——這是刻意的架構決策，不是隨手加的。

### 2.1 建立設計的七階段，對應到「畫面在哪」

依 [`apps/web/src/App.tsx`](https://github.com/nexu-io/open-design/blob/d4762a9522618339b00c1aa084e59a25ca26a0ca/apps/web/src/App.tsx) 的路由分派（約 2314–2469 行）與 [`ProjectView.tsx`](https://github.com/nexu-io/open-design/blob/d4762a9522618339b00c1aa084e59a25ca26a0ca/apps/web/src/components/ProjectView.tsx)（9800+ 行的單一元件）：

| # | 階段 | URL | 關鍵發現 |
|---|---|---|---|---|
| 1 | 啟動 Start | `/`（home） | `EntryView` 選 skill／design system／輸入 brief／可選檔案＋工作目錄 → `handleCreateProject`（`App.tsx:1443`）→ 一次 API 呼叫建專案 → **`navigate({ kind:'project', projectId, conversationId, fileName:null })`**，URL 立刻變成 `/projects/:id`。Home 只負責「開新的」，之後不會再被用到。 |
| 2 | 方向鎖定 Direction lock | 仍是 `/projects/:id` | 不是獨立頁面／彈窗——`AssistantMessage.tsx:2459` 直接把「Active design system selected. Visual direction is already locked.」當成一則對話訊息插進同一個 chat pane。 |
| 3 | 串流生成 | 仍是 `/projects/:id`，切換產物時變成 `/projects/:id/files/<path>` | Chat pane 與 artifact iframe 在同一畫面並排；產生／切換一個檔案，URL 會即時更新成該檔案的路徑，**可分享、可上一頁/下一頁**。 |
| 4 | 設計系統注入 | `/projects/:id`（讀取）／`/design-systems/:id`（管理） | Design system 是**獨立於任何專案的一級資源**：有自己的建立精靈路由 `/design-systems/create`、自己的詳情頁 `/design-systems/:id`，專案只是引用一個 `designSystemId`。 |
| 5 | 評鑑 Critique | 仍是 `/projects/:id`，不換路由 | 全新發現（比先前三份文件描述的「自我評鑑五維度分數」豐富很多）：[`CritiqueTheaterMount.tsx`](https://github.com/nexu-io/open-design/blob/d4762a9522618339b00c1aa084e59a25ca26a0ca/apps/web/src/components/Theater/CritiqueTheaterMount.tsx) 直接掛在 artifact iframe 旁邊，透過 SSE（`useCritiqueStream`）訂閱 daemon 的 `/api/projects/:id/critique/:runId/...`，即時呈現**多個 panelist**、**多輪（round）**評鑑、`ScoreTicker` 顯示 composite 分數對 threshold 的即時走勢，還有 `InterruptButton` 可中途打斷整個評鑑跑。這整套是設定開關控制（`useCritiqueTheaterEnabled`），關掉就完全不渲染，不影響其餘流程。 |
| 6 | 交付 Export/Handoff | 仍是 `/projects/:id`，皆為 in-page modal/dropdown | 兩個入口，都不換路由：(a) `HandoffButton`（ChatPane header 的下拉選單）→ 開本機編輯器，或複製一段 handoff prompt 給 Cursor/Claude Code/Codex 等 20+ CLI；(b) `FileViewer.tsx` 裡的 export modal（HTML/PDF/PPTX/MP4/ZIP）。 |
| 7 | 記憶 Memory | 折進 `/design-systems/:id` 與專案 metadata | `App.tsx:2259-2263`：只有回到 `route.kind==='home'` 時才 `refreshTemplates`／`refreshDesignSystems`，讓下次建立時看到最新偏好；不是獨立頁面。 |

**核心架構結論：一個設計 = 一個 URL 子樹。** 從第一次串流產生 artifact，到評鑑、到交付，全部發生在 `/projects/:id[...]` 底下；Home（`/`）只在「開始一個新東西」時被用到，過程中不會再被造訪。URL 的顆粒度細到「哪個檔案」「哪個對話」都可分享、可回上一頁。

## 3. SubDesign 實作前的頁面跳轉（本輪直接讀原始碼逐行追蹤）

### 3.1 建立設計那一刻，實際發生了什麼

`app/src/pages/SubDesignPage.tsx:198-224`：

```ts
const startSubDesign = () => {
  ...
  const threadId = createThread({ title: `SubDesign · ${activeSurface.title}`, ... })
  const created = createBrief({ threadId, ... })
  setSubDesignBriefId(threadId, created.id)
  selectBrief(created.id)
  setDraftInput(buildSubDesignPrompt(created, selectedSystem))
  navigate(`/?thread=${threadId}`)   // ← 離開 /subdesign，跳到根路由
}
```

`resumeBrief()`（223-234 行）做一樣的事：回到既有設計，也是 `navigate('/?thread=' + item.threadId)`。

**問題不只是「跳到別的頁面」，`?thread=` 這個查詢字串本身是死的：** 我在整個 `src/` 底下搜尋 `useSearchParams`／`get('thread')`，只有 `LearningPage.tsx`、`RecordsPage.tsx`、`AutomationPage.tsx` 用 `useSearchParams()`；**`ProtocolsPage.tsx`（`/` 的 index route）完全沒有讀取任何 query string。** 實際決定畫面顯示哪個 thread 的是 `useThreadStore` 的 `activeThread()`（`threadStore.ts:685-688`，`threads.find(t => t.id === activeId)`），而 `activeId` 是 `createThread()` 呼叫時的副作用，早在 `navigate()` 執行之前就已經設定好。也就是說：**`navigate('/?thread=' + threadId)` 這行程式碼裡的 `threadId` 從頭到尾沒有被任何程式讀取過**——它看起來像深連結，實際上只是 `navigate('/')`，`?thread=xxx` 純粹裝飾用，會誤導之後接手這段程式碼的人以為有 URL-driven 的 thread 還原機制。

### 3.2 到了 `/`（ProtocolsPage）之後，SubDesign 的痕跡在哪

`/` 是所有其他任務類型共用的通用對話頁。SubDesign 這次 run 唯一露出的痕跡是聊天氣泡裡的 `RunSummaryCard`（`ProtocolsPage.tsx:363`）。追進 `RunSummaryCard.tsx`：

- 整張卡片預設是**收合的**（`const [open, setOpen] = useState(false)`，第 16 行）——使用者要先點開「已變更 N 個檔案 / 執行過程 · N 項」這個泛用標題，才會看到裡面藏著的 SubDesign 資訊。
- 展開後的 SubDesign 區塊（54-59 行）只是純文字：stage、brief id、direction id、design system id、critique verdict、export 清單——**沒有任何按鈕或連結能點回 `/subdesign` 看 artifact 預覽、tweak 面板或交付面板。** 使用者只能自己想到要去左側導覽點「SubDesign」。
- 第 54-55 行還在用寫死的舊品牌色 `border-[#c96646]/20 bg-[#c96646]/5`、`text-[#c96646]`——這**直接牴觸** `docs/SUBDESIGN_OPEN_DESIGN_ANALYSIS_2026-07-13.md` 表格裡「已修復——全檔 grep 這三個字串零命中」的結論。實測：
  ```
  $ grep -rn "c96646" src/ --include="*.tsx" --include="*.ts"
  src//components/RunSummaryCard.tsx:54:  ...border-[#c96646]/20 bg-[#c96646]/5...
  src//components/RunSummaryCard.tsx:55:  ...text-[#c96646]...
  ```
  推測是該次 grep 在 `RunSummaryCard.tsx` 這個橋接元件被寫入 SubDesign 專屬區塊**之前**執行的，之後沒有人回頭複查這一個新增檔案。

### 3.3 想回到 `/subdesign` 看結果，靠的是什麼

`SubDesignPage.tsx:110`：

```ts
const activeBrief = briefs.find((item) => item.id === selectedBriefId) || briefs[0] || null
```

`selectedBriefId` 是 `useSubDesignStore` 的全域狀態，**不是 URL 參數**。`/subdesign` 沒有 `:briefId` 或 `?brief=` 這類路由——路由表裡就是單純的 `<Route path="subdesign" element={<SubDesignPage />} />`（`App.tsx:549`）。這代表：

1. 沒有可分享、可加書籤、可在瀏覽器上一頁/下一頁之間正確還原的「這個設計」網址。
2. 如果使用者在同一個 session 裡建立了第二個 SubDesign brief，或是中途去了別的頁面又回來，`/subdesign` 顯示的永遠是「最後一次被 `selectBrief()` 選中的那個」，不一定是使用者這次真正想找的那個。

### 3.4 這個缺口其實在最早的分析文件裡就被點名過

`docs/SUBDESIGN_OPEN_DESIGN_ANALYSIS_2026-07-13.md`（基準 `63bfbb2`，三份文件裡最舊的一份）表格原文：

> 流程斷裂 | Create brief 後跳到通用首頁 composer，SubDesign surface 不再持續呈現 | 使用者失去 stage、artifact、critique 的定位 | 將 thread 開啟為 `/subdesign?thread=<id>` 或在任務頁插入 SubDesign context bar

但後續 `SUBDESIGN_WORKFLOW_GAP_REVISION_PLAN_2026-07-13.md`（R1）與其 `_R2.md` 的逐階段核對表裡，**都沒有再單獨列一行核實這個項目**——R1 的「1. 啟動」那一行只核對了 catalog/provenance 有沒有接上 UI，沒有核對「建立後畫面去哪」；R2 只核對 R1 列出的 4 個缺口（evidence／bash 閘門／原地調整／記憶），這個項目沒有被繼承進 R2 的核對清單。也就是說，它在文件迭代過程中被悄悄漏掉，而不是被驗證後判定「已解決」——本輪直接讀程式碼證實它**確實沒有解決**，且比原始描述更嚴重（`?thread=` 是死參數，不只是「跳去別的頁面」）。

## 4. 缺口總表（實作前，依頁面跳轉影響排序）

| 優先度 | 缺口 | 證據 | 對使用者的影響 | R3 狀態 |
|---|---|---|---|---|
| P0 | `/subdesign` 沒有可深連結的 per-brief URL | `SubDesignPage.tsx:110`（靠全域 `selectedBriefId`）、`App.tsx:549`（路由無 `:briefId`） | 無法分享/收藏特定設計的網址；多個設計並行時容易顯示錯的那一個 | ✅ 已修復：`subdesign/:briefId?` + `useParams` |
| P0 | 建立設計後強制跳到通用 `/`，且 `?thread=` 參數完全沒被讀取 | `SubDesignPage.tsx:223,233`；`ProtocolsPage.tsx` 無 `useSearchParams` | 過程（串流生成、direction lock）完全脫離 SubDesign 的視覺與資訊架構，使用者體感像切換到另一個功能 | ✅ 已修復：建立／繼續皆留在 brief URL，執行可在頁內啟動 |
| P1 | `RunSummaryCard` 的 SubDesign 區塊預設收合、無回連按鈕、殘留 `#c96646` | `RunSummaryCard.tsx:16,53-59` | 使用者在通用頁面幾乎不會注意到有 SubDesign 進度可看；就算注意到也點不回去；視覺不一致的回歸 | ✅ 已修復：狀態列預設可見、可回跳、改用語意 token |
| P2 | Critique 是單次靜態分數卡，沒有 Open Design 的即時多輪／多 panelist／可中斷模型 | 本地 `CritiquePanel.tsx`、`critique.ts` 無 round/panelist/stream 概念，對照 Open Design `Theater/*` | 屬於功能豐富度差距，非阻斷性；R2 已指出目前的證據化單次評鑑已超越上游公開文件保證的嚴謹度 | ✅ 已修復：Critique Theater、兩輪三 panelist、live trace、可中止 |
| P2 | Design system 不是一級可導覽／可建立的資源 | 本地無 `/design-systems`、`/design-systems/create` 等價物；設計系統靠掃描 `DESIGN.md` 檔案 | 使用者無法在 SubDesign 之外瀏覽/管理/建立 design system；只要「每次 build 都注入」的需求已滿足，優先度不高 | ✅ 已修復：列表、建立、detail/edit deep routes |

## 5. 修改計畫書（第三輪，聚焦頁面跳轉）

### R3-P1：給 SubDesign 一個可深連結的 per-brief URL

**狀態：✅ 已完成。**

- 檔案：`app/src/App.tsx`（路由表）、`app/src/pages/SubDesignPage.tsx`
- 工作：
  1. 路由改成 `<Route path="subdesign/:briefId?" element={<SubDesignPage />} />`。
  2. `SubDesignPage` 用 `useParams<{ briefId?: string }>()` 讀取 `briefId`；有值時覆蓋 `selectedBriefId`（`selectBrief(briefId)`），沒有值才 fallback 回 store 裡的 `selectedBriefId`／`briefs[0]`。
  3. `startSubDesign()`／`resumeBrief()` 改成 `navigate(\`/subdesign/${created.id}\`)`，不要再繞去 `/`。
- 驗收：複製 `/subdesign/<briefId>` 網址、重新整理或在新分頁開啟，畫面直接還原到同一個設計（brief／artifact／critique／export 都對得上），不依賴任何全域 store 的「上次選取」。

### R3-P2：過程階段不要離開 SubDesign 的資訊架構

**狀態：✅ 已完成。**

考慮到 agent 執行本身仍走既有的 `runExternal`/`engine` 生命週期（CLAUDE.md 明訂「All entry points go through ONE lifecycle controller」，不應該為 SubDesign 另建一條），**不建議**把整個 chat/tool-call 串流搬進 `/subdesign` 頁面重做一份。較小風險的做法：

- 檔案：`app/src/pages/SubDesignPage.tsx`
- 工作：`startSubDesign()` 之後，若該 thread 仍在執行（`agentStore.isRunning` 且對應 `runId` 屬於這個 thread），在 `/subdesign/<briefId>` 頁面上方插入一個精簡的「執行中」狀態列（複用既有 `RunProcessFeed`／`RunSummaryCard` 的資料源，而不是重新接一條 stream），讓使用者不必離開 SubDesign 就能看到目前在跑什麼工具；點擊可展開跳到 `/?thread=<id>` 看完整逐字稿（這時才需要離開，是使用者主動選擇，不是被迫）。
- 驗收：建立設計後停留在 `/subdesign/<briefId>`，仍能看到目前執行進度，不必手動跳頁。

### R3-P3：修好通用頁面到 SubDesign 的回連

**狀態：✅ 已完成。**

- 檔案：`app/src/components/RunSummaryCard.tsx`
- 工作：
  1. `summary.subDesign` 區塊搬到收合開關**之外**（或給它自己獨立的、預設展開的小卡），因為它是這則訊息裡最可操作的資訊。
  2. 加一個「查看設計」按鈕／連結，`navigate(\`/subdesign/${summary.subDesign.briefId}\`)`（依 R3-P1 完成後的路由）。
  3. 把 `border-[#c96646]/20`、`bg-[#c96646]/5`、`text-[#c96646]` 三處換成既有語意 token（例如 `border-primary/20`、`bg-primary/5`、`text-primary`），和 `SubDesignPage.tsx` 其餘部分保持一致。
- 驗收：`grep -rn "c96646" app/src` 零命中；在 `/` 的聊天串裡，SubDesign 相關訊息一眼就能看到狀態，並能一鍵回到對應設計頁。

### R3-P4（可選，優先度較低）：評估是否需要即時／多輪 critique

**狀態：✅ 已完成。**

- 新增 `CritiqueTheater` 與 `subDesignCritiqueSessionStore`：兩輪 × 三 panelist（視覺與品牌、可及性、實作就緒），以 round cards、composite score ticker、live review trace 呈現。
- 啟動時仍統一走既有 `runTask` lifecycle；使用 `runActivityStore` 作為即時通道，agent run 只讀取 artifact / evidence，並以 blocked tools 防止 patch、tweak、export、workspace mutation。
- 使用者可中止 review；中止的 round 不會被誤標為完成，也不會進入 Deliver gate。完成後只有真正寫入的 `design_critique` 結果才會填入 panelist 分數與 verdict。

### R3-P5（可選，優先度較低）：Design system 是否需要一級路由與 Studio handoff

**狀態：✅ 已完成（依 source-flow 對齊）。**

- 新增 `/design-systems` 列表、`/design-systems/create` 建立精靈與 `/design-systems/:id` detail/edit deep link，並加入側欄與 SubDesign 選擇器的管理入口。
- 建立／更新沿用既有 Electron workspace API 與 project-relative `DESIGN.md` 安全邊界；列表仍由現有 `scanDesignSystems` 掃描並注入 SubDesign build。
- `project` root DESIGN.md 可 detail/read；自訂 system 可在 Electron 中建立與編輯，Browser preview 會明確提示沒有 workspace write API。
- 建立頁現在先收集品牌背景與選擇性的 URL／Screenshot source，建立 `design-system` SubDesign brief，透過既有安全 importReference 保存 reference、SHA-256、token 摘要與 provenance，再 handoff 到同一個 SubDesign Studio。
- Studio prompt 對 `design-system` surface 明確要求在 direction lock 後用 `design_system_create` 或 `design_system_update` 產生／修訂可重用的 DESIGN.md，並沿用同一套 critique / delivery，而非建立後停在孤立 markdown detail。

## 6. 驗收定義（第三輪）

- [x] 從 `/subdesign` 建立一個設計後，網址變成該設計專屬、可複製分享、重新整理可還原的 URL（不是 `/?thread=` 這種未被讀取的死參數）。
- [x] 停留在 SubDesign 的頁面內，就能看到目前執行進度，不被強制推去通用對話頁。
- [x] 若使用者確實去了通用對話頁，該頁面上有清楚、預設可見（不需先展開）、能一鍵導回的 SubDesign 狀態列。
- [x] `app/src` 內不再有任何 `#c96646` 殘留。
- [x] 以上四項用實際點擊 + 網址列觀察驗證，不只是讀程式碼推論。

## 7. 本輪採用決策與驗證

- 建立 brief 後留在 `/subdesign/<briefId>`；頁面提供「在此頁開始執行」，執行仍統一走既有 `runTask` lifecycle，不另建 SubDesign 專用 runner。
- 執行中的頁面狀態列複用 `RunProcessFeed` 與 `runActivityStore`；需要完整逐字稿時，使用者可主動開啟 `/?thread=<threadId>`。
- `RunSummaryCard` 的 SubDesign 狀態移到收合區外，並提供「查看設計」回跳；舊 `#c96646` 已清除。
- R3-P4 已納入本輪：以既有 agent lifecycle + run activity stream 完成。R3-P5 保留 Open Design 同型的全域 catalog route，也把實際使用主線接成「brand source → Design System Studio → direction → agent build → critique / delivery」。
- 驗證方式：`app/scripts/smoke-caps.mjs` 以原始碼契約檢查 route、live feed、回跳連結與舊色碼零命中；另執行 `npm run build`、`npm run smoke`、`npx oxlint src`、`git diff --check`。
- 本地 UI smoke 已實際建立 brief、重新整理 deep link、啟動頁內 run、確認 LIVE 狀態，並從通用頁的「查看設計」返回同一個 `#/subdesign/<briefId>`。

## 8. P4/P5 驗收

- [x] Critique Theater 可啟動真實 read-only critique run，顯示兩輪、三 panelist、composite score 與 live review trace。
- [x] Critique Theater 可由使用者中止；中止不會宣稱 critique pass，也不會繞過 Deliver gate。
- [x] `/design-systems` 可列出專案與自訂 Design System，並提供搜尋與 deep link。
- [x] `/design-systems/create` 可建立 project-relative `.subagents/subdesign/design-systems/<id>/DESIGN.md`。
- [x] `/design-systems/:id` 可讀取、檢視 metadata，並在 Electron workspace 中編輯保存 DESIGN.md。
- [x] 建立流程已改為「brand source intake → Design System SubDesign brief / Studio → agent 產生或修訂 DESIGN.md」，而非直接停在手動 markdown detail。
