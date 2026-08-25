# 發布計畫：context-usage-panel tracker 檔案（只發布，不開工）

批准離開 plan mode 後執行以下三個動作：

## 1. 建立 `.scratch/context-usage-panel/spec.md`

完整內容已在本對話定稿（Problem Statement / Solution / 20 條 User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes / Tickets 表），開頭帶：

```
> 狀態：`可交給代理`
```

## 2. 建立 8 張票 `.scratch/context-usage-panel/issues/NN-*.md`

每張格式比照 `.scratch/unified-run-timeline/issues/` 慣例：標題、`Status: 可交給代理`、`Spec:` 回指、`Blocked by:`、What to build、Acceptance criteria checkboxes。

| # | 檔名 | 內容摘要 | Blocked by |
|---|------|---------|-----------|
| 01 | 01-usage-record-capture.md | `PiStepTiming.usage` 加 optional `cachedRead/cachedWrite/costUsd`；piCoreRuntime reducer 從 Pi `Usage` 補抓 cache 與 cost（catalog 定價）；turnRecord parse smoke 延伸「缺欄位舊記錄輸出不變」斷言 | — |
| 02 | 02-openai-compat-capture-pricing.md | transport 補 parse `prompt_tokens/completion_tokens/cached_tokens`；`ModelProfile` 加 optional `pricing`（Settings 可編輯）；無 pricing 不計成本 | 01 |
| 03 | 03-context-projection.md | `projectContextUsage(record, {contextWindow?})` 純投影；量測優先、估算只做比例、running 不猜數；新 smoke 掛進 smoke 鏈；四支既有投影 smoke 延伸 | 01 |
| 04 | 04-context-usage-panel.md | InlineRunPanel 新增「上下文」PanelSection（新元件 ContextUsagePanel）；比率條/細分條/mono 數字，全用既有 design token；live 讀 recordEntries | 03 |
| 05 | 05-feed-header-microcopy.md | RunProcessFeed header 計數旁加 `73.2k tok (7%)`，點擊展開上下文區塊（沿用 onOpenPanel） | 03, 04 |
| 06 | 06-cost-slash-upgrade.md | `/cost` 輸出投影完整分解，整併 `/tokens` `/usage` 別名 | 03 |
| 07 | 07-finished-run-presentation.md | ThreadRunSummary 加 `tokens/costUsd`（氣泡顯示）；TrajectoryPanel footer 補快取與成本；外部 CLI 降級路徑（scalar only） | 01, 03 |
| 08 | 08-qualification.md | 完整驗收：`npm run build` + 新 smoke + 四支投影 smoke + oxlint + 手動 UI 檢查清單 | 01–07 |

依賴結構：01 先行 → 02/03 並行 → 04/06/07 並行 → 05 → 08 收口。

## 3. 更新 `.scratch/INDEX.md`

Active frontier 表新增一列：

```
| **context-usage-panel** | [spec.md](context-usage-panel/spec.md) | [01 usage 記錄擴充](context-usage-panel/issues/01-usage-record-capture.md) | 8 張 `可交給代理` tickets；01 先行，02/03 並行，04/06/07 並行，05←03+04，08 收口。動機：opencode 式 session 上下文面板，token/cost 落在 step-end（ADR-0039/0049 語意） |
```

## 範圍

- 只寫入 tracker 檔案（spec + 8 tickets + INDEX.md）。
- 不實作任何程式碼；不動 `app/src`。
