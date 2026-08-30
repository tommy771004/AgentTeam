# 01 — 自適應 Agent 執行狀態 surface

Status: 可交給代理
Spec: `.scratch/adaptive-agent-run-status-surface/spec.md`

## What to build

把 live run rail 的預設資訊架構改成「執行狀態」加一個依證據能力切換的第二區：可靠 Host Working State 顯示「任務進度」，無可靠 goals 顯示「最近活動」，等待使用者時顯示「需要你處理」，terminal run 顯示「執行摘要」，沒有實質內容則隱藏。完整 instructions、reference chat、絕對路徑、Host revision 與 runner guarantee 不得出現在預設狀態內容，改由既有診斷／軌跡 surface 承載。

## Acceptance criteria

- [ ] 第一區標題為「執行狀態」，只顯示 bounded trusted runtime phase、經過時間與可選的最後更新資訊
- [ ] objective、assistant text、instruction bodies、reference chat history、constraints、絕對路徑與 raw tool output 不能成為執行狀態文案來源
- [ ] Goal-based builtin 且存在可靠 Host Working State 時，第二區顯示「任務進度」與 pending/current/done/blocked milestones
- [ ] External CLI、turn-based 或無可靠 goals 的 run 顯示最近三至五筆可信「最近活動」，不顯示虛構的已驗證數量
- [ ] approval、authentication 與 user-input 狀態優先顯示「需要你處理」及單一明確動作
- [ ] completed、cancelled 與 failed run 顯示 bounded「執行摘要」，External CLI process success 不冒充 Checker-backed completion
- [ ] 簡單單步 run 沒有第二層資訊時整區隱藏，不顯示空目標或 placeholder progress
- [ ] 百分比與 progressbar 只在 denominator 穩定可知時顯示；其餘 run 保持 indeterminate
- [ ] Host verification、revision、runner guarantee、instruction provenance 與 evidence identities 只出現在收合診斷／軌跡 surface
- [ ] primary lifecycle 使用 polite status semantics；activity 列表不造成 live-region spam；disclosure 保持鍵盤可用
- [ ] live、reload、archive 與 replay 對同一 record 選出相同 variant 與 milestone ordering
- [ ] 一支最高層 rendered run-panel smoke 覆蓋 builtin、External CLI、waiting、terminal、simple-hide 與 hostile-instruction fixtures，且掛入實際 smoke gate
- [ ] focused smoke、`npm run build`、`npx oxlint src` 與完整 `npm run smoke` 全綠

## Blocked by

無

