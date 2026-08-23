# 08 — 其餘工具接上呈現契約（批次）

**What to build:** 參考工具以外的其餘內建工具各自宣告自己的卡片，讓執行過程整體讀起來一致，而不是一半有型、一半通用。批次進行，每批之後 UI 仍然可用 —— 未接上的工具本來就安全退回通用卡。

**Blocked by:** 07

**Status:** 可交給代理

- [ ] 其餘內建工具依其行為宣告 `presentCall` / `presentResult`（必要時含 `locations`）
- [ ] 每一個宣告都是 replay-pure，且在畸形舊參數下退回通用卡
- [ ] 會產生副作用的工具正確宣告為 `diff` 或帶 `locations`，因此自動進入產出檔案清單
- [ ] 批次可分次落地：任一批之後 build 與 smoke 全綠
- [ ] Seam 2 smoke：以帳本 fixture 覆蓋每個新接上的卡片型別
