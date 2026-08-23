# 01 — Iteration-exhausted 誠實終態語彙

**What to build:** 當一個 run 以 `success` 收尾但 DoD 未達成且迭代已用盡上限,使用者看到的不會是普通的「已完成」。lifecycle 投影輸出「已完成(未達 DoD · 用盡 N 輪)」、attention 級色調、非成功勾勾的 icon;process feed 終態列、run summary card、SubDesign workspace 的 run 呈現三處消費同一投影輸出。一般使用者照畫面就能分辨「agent 認為做完了」和「預算用完被截斷了」。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] lifecycle input 支援選填的 orchestration 迭代資料(iterations / maxIterations / dodMet,Pi Host settlement 已攜帶)
- [x] `success + dodMet=false + iterations ≥ maxIterations` 時,label 為「已完成(未達 DoD · 用盡 N 輪)」,tone 為 attention 級,icon 不沿用 success 勾
- [x] HITL(awaiting_user / manual_intervention)優先序不受影響;activity phase 優先序維持不變
- [x] RunProcessFeed 終態列、ThreadRunSummary、SubDesign runStatus 呈現三處顯示同一文案,不各自判斷
- [x] ThreadRunSummary 型別帶有 dodMet 與迭代數,archive 可事後查證收尾方式
- [x] 外部 CLI run 不受影響(其本就不宣稱 DoD)
- [x] shipped-module smoke 斷言投影函數的耗盡文案與 tone;HITL 優先案例在列
