# 04 — Usage 輪詢契約硬化＋右欄隔離補完

Status: 可交給代理
Effort: subscription-surface-hardening

## 問題

1. 晚到的 poll 頁經 appendRecordEntries 寫入時會設 `active: true`／清 `draftText`——一個已結束 run 的 presentation 若尚未落 terminal digest，可能被翻回進行中。
2. R1 的「其他區塊不因用量重繪」目前只在主 feed 成立；右欄仍以頂層 hook 整面訂閱。

## 驗收條件

- [ ] refresher 寫回前複查該 run 是否仍在活躍集合（activeRunIds）；不在則整頁丟棄不寫。
- [ ] 防復發 guard（source-text 或行為層）斷言晚到寫入不得翻轉非活躍 presentation。
- [ ] 右欄用量微縮文字比照主 feed 改由 memo leaf 自行訂閱；主 feed 行為不變。
- [ ] attach-as-poll 契約借用與 hidden-tab ≥3s 取捨的既有程式註解保留（已聲明的設計決策，不改道新 IPC）。
- [ ] 生命週期回歸：interval 清理、in-flight 去重、feature-detect 三項既有保證不退化。
