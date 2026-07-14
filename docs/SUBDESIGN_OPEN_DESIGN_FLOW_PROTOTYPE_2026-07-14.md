# SubDesign × Open Design：使用流程缺口與 UI Prototype

> 日期：2026-07-14
> 對標來源：[nexu-io/open-design](https://github.com/nexu-io/open-design)（README 與目前公開產品定位）
> 範圍：使用流程與資訊架構，不重複評估已存在的 agent 執行、critique 與匯出業務邏輯。

## 結論

SubDesign 已具備 Open Design 的重要流程骨架：每個 brief 的 deep link、留在 Studio 的 run feed、artifact preview、兩輪多角色 critique、delivery gate，以及 Design System 的獨立路由。現階段的主要差距不是「少一個功能」，而是這些能力在同一個專案工作階段裡的**持續可見性與可理解性**不足。

Open Design 把專案視為一個長駐的工作區：使用者從 brief 進入後，持續在同一個 project context 裡對話、查看 artifact、review、handoff。SubDesign 雖然已有對等元件，但目前以「建立表單 → 最近 brief → reference → artifact / critique / delivery」的縱向頁面排列；當 brief 變多、artifact 變多或 run 正在執行時，使用者需要自己重新拼湊目前所處的階段與下一個可行動作。

## 已對齊，不列為本輪缺口

| 能力 | SubDesign 現況 | 判定 |
| --- | --- | --- |
| 專案 deep link | `/subdesign/:briefId?` | 已對齊核心需求 |
| 建立後留在設計頁 | 在頁內透過 `runTask` 啟動，並顯示 `RunProcessFeed` | 已對齊核心需求 |
| artifact、critique、交付 | `ArtifactRail`、`CritiqueTheater`、`ArtifactDeliveryPanel` | 已具備 |
| 多輪 / 多角色 critique | Critique Theater 含兩輪、三 panelist、live trace 與中止 | 已具備 |
| Design System 一級資源 | `/design-systems`、建立與 detail/edit route | 已具備 |

## 仍存在的流程缺口

| 優先度 | 缺口 | 現況證據 | 對使用者的影響 | 建議方向 |
| --- | --- | --- | --- | --- |
| P0 | 專案階段沒有常駐框架 | stage 只散見於 recent brief、run feed、critique/delivery 區塊 | 不容易一眼判斷「現在在哪一關、下一關為何被鎖」 | 常駐 Brief → Direction → Build → Critique → Deliver 的 project rail，並顯示 current gate |
| P0 | 執行進度偏工具／訊息導向 | `RunProcessFeed` 有即時活動，但未與 artifact 與 gate 合併成單一決策面 | 使用者知道 agent 在跑，卻未必知道完成後將產生什麼或需要自己決定什麼 | 把 live activity、輸出、下一個 gate 組成 run inspector |
| P1 | artifact-first 操作缺少 project shell | `ArtifactRail`、preview、tweak、critique、delivery 已存在但位於頁面下方 | 多 artifact、多 revision 時，檔案切換與 review/handoff 的關係不夠直接 | 將 artifact rail、preview、inspector 保持在同一工作區視圖 |
| P1 | brief 恢復入口像清單，不像工作階段 | 「繼續最近設計」能回到 brief，但進入後主要仍是長頁面 | 從上次中斷處恢復時，缺乏「上次停在哪個 gate／待處理事項」的提示 | recent brief 顯示 last artifact、run state、blocked gate、next action |
| P2 | runner / model 是執行設定，非專案可見決策 | 設定存在於全域 LLM / runner 層，SubDesign 建立時不聚焦呈現 | 使用者較難理解本次設計如何被執行，也難比較不同 run 的結果 | 在 project header 顯示 runner/model 摘要；先做唯讀，再評估 project scoped override |

## 本輪 prototype

Prototype 是開發環境限定、唯讀、不可持久化的介面研究；不會呼叫 `runTask`、寫入 brief、修改 artifact，亦不改變正式 `/subdesign/:briefId?` 流程。

啟動後開啟：

```text
http://localhost:5173/#/subdesign?prototype=subdesign-flow&variant=A
```

也可將 `variant` 改為 `B` 或 `C`，或使用左右方向鍵切換（焦點在輸入欄時不攔截按鍵）。

| Variant | 問題 | 對應缺口 | 適用時機 |
| --- | --- | --- | --- |
| A · 階段導向 Studio | 是否應把設計旅程固定在頁首？ | P0 project stage / next gate | 最適合做為正式版的漸進式基礎 |
| B · 任務時間線 | 使用者是否更在意現在發生什麼？ | P0 run comprehension | 長時間 run、背景執行與除錯 |
| C · 專案工作台 | artifact 與交付是否該成為主視圖？ | P1 artifact-first shell | 多 revision、review、handoff 密集的專案 |

## 分階段建議

- [ ] P0：確認正式資訊架構採 A 的 stage rail，定義 `currentStage`、`nextGate`、`blockedReason` 的唯讀 view model。
- [ ] P0：把既有 run activity、selected artifact、critique verdict 組合成同一個 project header / inspector；不另建 runner 或 stream。
- [ ] P1：將既有 `ArtifactRail`、`ArtifactPreview`、`CritiqueTheater`、`ArtifactDeliveryPanel` 重組為可維持選取狀態的工作區版面。
- [ ] P1：在「繼續最近設計」顯示 last artifact、last run、下一個待辦 gate。
- [ ] P2：先在 header 呈現本次 runner/model/capability 摘要；確認使用者需求後再評估 project scoped override。
- [x] Prototype：完成 A/B/C 三種唯讀 layout，並以 dev-only route guard 隔離正式流程。

## 建議採用

先採 **Variant A**。它只需要組合既有的 brief、run、artifact 與 critique 狀態，不需要改動 `taskRunCoordinator`、SubDesign store 或 delivery gate。Variant B 可作為 A 裡的執行中面板；Variant C 則適合在 artifact / revision 數量增加後再導入，避免過早把簡單的單一輸出流程做成重量級 IDE。
