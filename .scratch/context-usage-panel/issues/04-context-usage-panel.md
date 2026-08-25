# 04 — ContextUsagePanel + 執行摘要區塊

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

新元件 ContextUsagePanel，掛在 InlineRunPanel 既有狀態塊之後、詳細紀錄之前，作為一個「上下文」`PanelSection`（沿用現有手風琴 idiom）。內容：

```
上下文 ────────────────── ⌄
73,166 / 1,000,000 tokens · US$0.00   7%
▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░  ← 單色細進度條
● 助理 11% ● 工具 87% ● 其他 2%   ← 細分條（accent 三階）
輸入 72,832 · 輸出 213 · 快取讀 0 · 快取寫 0
訊息 33 · 工具 12 · 步驟 9
```

資料源：live 讀 `presentations[runId].recordEntries` + `recordTotal`，全部經 03 的 `projectContextUsage` 推導；contextWindow 用現行解析鏈（modelProfiles → default），比率未知時省略。外部 CLI runner（無 Turn Record）退回現行 scalar，如實降級。樣式全用既有 design token：`bg-inset`、10px tracking 區塊標題、mono + `tabular-nums`、Material Symbols、單色進度條與 accent 色階細分條；不引入新漸層、glow 或新字體。UI 文案 Traditional Chinese mixed with English。

## Acceptance criteria

- [ ] 面板只顯示投影輸出，不自算第二份數字
- [ ] live 執行中數字隨 step settle 更新；進行中 step 顯示 running 不猜數字
- [ ] contextWindow 未知時比率列省略；無 pricing 時成本列省略
- [ ] 外部 CLI runner 降級為 scalar 呈現，不顯示分解
- [ ] `npm run build` 通過；面板掛載點不破壞既有 PanelSection 行為

## Blocked by

03 — contextProjection 純投影 + smoke
