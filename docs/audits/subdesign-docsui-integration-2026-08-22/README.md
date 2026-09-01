# docs/ui × SubDesign 整合設計規格

日期：2026-08-22

## 目的

`docs/ui` 的十二份元件規格是同一個 task run 的不同視圖（見 `docs/ui/Lifecycle.md`）。本文件把它們逐一套用到 SubDesign 的每個 surface，定義「整合後長什麼樣」，並以 DEV prototype（`app/src/components/subdesign/SubDesignDocsUi.prototype.tsx`）產出實際截圖作為視覺證據。

App 的 theme 已內建 docs/ui primitive vocabulary（`app/src/index.css:49-94` 的 `ink`／`field`／`line`／`shadow-card` tokens 與 `fade-up`／`pop-in` keyframes），因此整合不需新增任何設計 token。

## 對照總表

| # | docs/ui 規格 | SubDesign surface | 整合重點 |
| --- | --- | --- | --- |
| 01 | Prompt Bar.md + Chat.md | 左欄 conversation composer | `@` 引用 brief 來源、`/` 呼叫 SubDesign 指令、附件 chips、模型 picker |
| 02 | Thinking.md | run 前段敘事（narrative → direction） | Steps 變體：整理 brief → 比較方向 → 生成 reference → 註冊 artifact；收起後留一行「思考完成 · N 秒」 |
| 03 | Tool Chips.md + Loading State.md | plugin 執行過程（build） | 工具呼叫列 + 檔案 diff chips；build 期間用 pixel loader（Drive）+ mono 計時 |
| 04 | Task Rows.md | lifecycle stages（brief → direction → build → critique → deliver） | List 變體卡：進度環、數量量欄、狀態 pill、可展開 detail |
| 05 | approve.md | 方向選擇與 awaiting_user 問答 | 單選 + 自訂答案 + ring-dot pager 的問卷卡，取代現有 direction grid fallback |
| 06 | Context Cards.md | 參考圖與 provenance（ReferenceImportPanel） | chunk 卡：標題列 + 摘要 + 來源 badge（PNG／MD），先於 artifact 呈現證據 |
| 07 | Streaming Text.md | Critique 回饋與 assistant 回覆 | 文字 blur-in、DESIGN.md citation chip、動作列、follow-ups |
| 08 | Diff Table.md | artifact revision 比較（r1 → r2） | 移除章節紅 tint 劃線、新增章節綠 tint；接受／拒絕分離 |
| 09 | Recommendation Card.md | Deliver gate 格式建議 | 信號 meter + alternatives drawer + 主要確認鍵；PDF／MP4 為可晉升選項 |
| 10 | Code Block.md | 匯出檔案預覽（export.html） | `data-token` 語法著色 + Copy；Preview／Code 切換共用同一份 |

Chat.md 的 tab＋composer 結構由 01（composer）與 07（訊息流）共同承擔，不另立 surface。

## Lifecycle grammar 套用

沿用 `docs/ui/Lifecycle.md` 的規則，對應到 SubDesign：

| Phase | Primary surface | SubDesign 對應 |
| --- | --- | --- |
| `starting` | Loading State | pixel loader 掛在 conversation pane 頂端，附 mono 計時 |
| `planning` | Thinking | Steps trace：整理 brief、比較方向 |
| `thinking` | Tool Chips | plugin 讀取 brief 與 references |
| `executing` | Tool Chips + Task Rows | Write deck.html、storybook capture、diff chips |
| `awaiting_user` | approve 卡 | 方向選擇、critique 問答；不使用 shimmer 假裝運算 |
| `responding` | Streaming Text | critique 結論與 follow-ups |
| `finalizing` | Diff Table + Recommendation Card | revision 差異表 → 交付格式建議 |
| terminal | Run Summary | 維持現有 RunSummaryCard，不再啟動動畫 |

## 實作檢查表（後續工程）

- [x] Composer：`SubDesignConversationPane` 已升級為 Prompt Bar 結構（真實 brief references／provenance chips、`@` sources、`/direction`／`/critique`／`/tweak`／`/deliver`，沿用 follow-up 的 `runTask` ingress）。
- [x] Run feed：`RunProcessFeed` 在 SubDesign context 以真實 `RunTaskItem` 呈現 Thinking Steps，並沿用真實 tool/file events 的 Tool Chips 與 diff chips。
- [x] 方向選擇：direction grid fallback 已換成 approve 卡；瀏覽 radio 只改 candidate，明確送出才透過 `McpAppSurface` choice 回寫，另支援可持久化的自訂方向。
- [x] Context Cards：`ReferenceImportPanel` 以真實 reference/provenance 輸出 chunk 卡，包含 source、digest／SHA-256 摘要與類型 badge。
- [x] Deliver：`ArtifactDeliveryPanel` 已加入由 critique 分數與 artifact exports 推導的 Recommendation Card（信號 meter + alternatives），並直接重用 `ArtifactRevisionDiff` 的真實 snapshot Diff Table。
- [x] 全部遵守：workspace 的 `isSubDesignRunLive` 是 UI 與寫入 guard 共用的單一 predicate；raw adapter 的舊 `runIsLive` hint 不再成為第二 authority，live run 期間 pin/restore 均 fail closed。

## Production closure（2026-09-01）

- `npx tsc -b`、`smoke-subdesign-workspace.mts`、`smoke-subdesign-studio.mts`、`smoke-subdesign-artifact-snapshots.mts`、`smoke-open-design-providers.mts` 與 effort-scoped oxlint 全部通過。
- 瀏覽器實際掛載 `SubDesignUnifiedFixture` 所使用的 production component tree：確認方向需明確送出、Context Cards 讀真實 reference/provenance、follow-up live run 顯示 Thinking steps、tool event、file diff 與 Stop。
- fixture 只提供 deterministic stores/props；workflow owner、projection、MCP fallback 與元件皆是 production modules，沒有把 `SubDesignDocsUi.prototype.tsx` 當作完成證據。

## 視覺證據

截圖由 `app/scripts/capture-docsui-integration.mjs` 產生（dev server + Playwright，`#/subdesign?prototype=subdesign-docsui`）：

- 全頁總覽：![full page](./00-full-page.png)
- 01 Composer：![composer](./01-composer-prompt-bar.png)
- 02 Thinking：![thinking](./02-thinking-run-narrative.png)
- 03 Tool Chips + Loading：![tools](./03-tool-chips-loading-state.png)
- 04 Task Rows：![tasks](./04-task-rows-lifecycle.png)
- 05 approve 方向卡：![direction](./05-approve-direction-choice.png)
- 06 Context Cards：![context](./06-context-cards-references.png)
- 07 Streaming critique：![critique](./07-streaming-text-critique.png)
- 08 Diff Table：![diff](./08-diff-table-revision.png)
- 09 Recommendation：![deliver](./09-recommendation-card-deliver.png)
- 10 Code Block：![code](./10-code-block-export.png)

## 驗證限制

`SubDesignDocsUi.prototype.tsx` 仍只是 DEV-only 視覺參考，不是 workflow owner。production closure 改由正式元件樹與 workspace smoke 提供證據；deterministic fixture 只注入資料及操作，不複製 lifecycle 或另建 store。
