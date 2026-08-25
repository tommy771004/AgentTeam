# 01 — usage 記錄擴充 + Host 補抓

Status: 可交給代理
Spec: `.scratch/context-usage-panel/spec.md`

## What to build

`step-end` 的 `timing.usage` 增加 optional `cachedRead` / `cachedWrite` / `costUsd` 欄位（turnRecord.ts 的 `PiStepTiming`）。Pi Core Runtime 組 step timing 的 reducer 補抓 Pi `Usage` 既有的 `cacheRead` / `cacheWrite`，並以 Pi model catalog 的 `cost` 定價計得 `costUsd`——這些值已存在於每則 assistant message 的 usage，現行 reducer 只挑 input/output/total 而丟棄它們。記錄格式版本不動：全為 optional 欄位，舊記錄照樣 parse 與投影。

## Acceptance criteria

- [ ] `PiStepTiming.usage` 帶 optional `cachedRead` / `cachedWrite` / `costUsd`，型別與 guard 一致
- [ ] Pi Host 路徑的每個 `step-end` 在 provider 有回報時寫入快取與成本；無回報時欄位缺席（不補 0）
- [ ] 成本由 catalog 定價計得；catalog 無定價時 `costUsd` 缺席，不發明數字
- [ ] turnRecord parse smoke 延伸：帶新欄位的 entry 可讀、缺欄位的舊記錄投影輸出完全不變（向後相容逐欄斷言）
- [ ] `stepTimings()` 視圖透傳新欄位；`smoke-trajectory-paging` 全綠

## Blocked by

無（tracer bullet，先行）
