# 01 — SubDesign 階段與下一關卡

**What to build:** 使用者開啟任一 SubDesign brief 時，能在同一個 project context 清楚看到 Brief、Direction、Build、Critique、Deliver 五個階段，以及目前階段、下一個 gate、阻擋原因與下一個可行動作。狀態必須由既有 canonical brief、artifact、run、critique 與 delivery eligibility 推導，不建立第二份可漂移的流程狀態。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] 新 brief、無 artifact、已完成 build、critique pending、critique passed 與 delivery locked 都能顯示正確階段狀態。
- [x] Stage rail 對 completed、active、pending、locked 有明確視覺差異，並在窄版畫面保持可讀。
- [x] 下一 gate、阻擋原因與 primary next action 對使用者可理解，且不誤宣稱外部 CLI DoD 或 critique pass。
- [x] view model 的純邏輯測試覆蓋主要狀態轉換；不持久化自有 stage state。
- [x] 現有 `/subdesign/:briefId` deep link 與建立／resume 流程維持不變。
