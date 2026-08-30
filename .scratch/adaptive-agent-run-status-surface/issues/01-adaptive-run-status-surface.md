# 01 — 自適應 Agent 執行狀態 surface

Status: resolved
Spec: `.scratch/adaptive-agent-run-status-surface/spec.md`

## What to build

把 live run rail 的預設資訊架構改成「執行狀態」加一個自適應第二區：Agent 回傳的 structured run tasks 顯示「任務進度」，沒有 tasks 顯示「最近活動」，等待使用者時顯示「需要你處理」，terminal run 顯示「執行摘要」，沒有實質內容則隱藏。Working State objective、完整 instructions、reference chat、絕對路徑、Host revision 與 runner guarantee 不得出現在預設狀態內容，改由既有診斷／軌跡 surface 承載。

## Acceptance criteria

- [x] 第一區標題為「執行狀態」，只顯示 bounded trusted runtime phase、經過時間與可選的最後更新資訊
- [x] objective、assistant text、instruction bodies、reference chat history、constraints、絕對路徑與 raw tool output 不能成為執行狀態文案來源
- [x] Agent 回傳 structured run tasks 時，第二區以 `Task Rows` 顯示 pending/active/done/failed；admitted objective／Working State prose 不得作為 fallback
- [x] stable task id、短 meta 與可展開 child details 經 live、reload fallback、terminal archive 保留；新 run 在 admission 時清除舊 plan
- [x] External CLI、turn-based 或無可靠 goals 的 run 顯示最近三至五筆可信「最近活動」，不顯示虛構的已驗證數量
- [x] approval、authentication 與 user-input 狀態優先顯示「需要你處理」及單一明確動作
- [x] completed、cancelled 與 failed run 顯示 bounded「執行摘要」，External CLI process success 不冒充 Checker-backed completion
- [x] 簡單單步 run 沒有第二層資訊時整區隱藏，不顯示空目標或 placeholder progress
- [x] 百分比與 progressbar 只在 denominator 穩定可知時顯示；其餘 run 保持 indeterminate
- [x] Host verification、revision、runner guarantee、instruction provenance 與 evidence identities 只出現在收合診斷／軌跡 surface
- [x] primary lifecycle 使用 polite status semantics；activity 列表不造成 live-region spam；disclosure 保持鍵盤可用
- [x] live、reload、archive 與 replay 對同一 record 選出相同 variant 與 milestone ordering
- [x] 一支最高層 rendered run-panel smoke 覆蓋 builtin、External CLI、waiting、terminal、simple-hide 與 hostile-instruction fixtures，且掛入實際 smoke gate
- [x] focused smoke、`npm run build`、`npx oxlint src` 與完整 `npm run smoke` 全綠

Qualification: [`.scratch/adaptive-agent-run-status-surface/qualification.md`](../qualification.md)

## Blocked by

無
