# 11 — 外部 CLI run 產出同一份 Turn Record

**What to build:** 使用外部 CLI provider 的使用者，看到的執行過程與內建 run 是同一種形狀，不會因為換了 provider 就掉進一個比較差的舊檢視。同時，記錄上仍然明確寫著這條路徑沒有執行內建的 Parse／DoD／iterate —— 呈現一致永遠不等於保證一致。

**Blocked by:** 07

**Status:** 可交給代理

- [ ] 外部 CLI 執行寫入與內建相同的帳本條目種類，經同一個 seam
- [ ] 外部 run 的對話列與執行過程列由同一個投影函式產生
- [ ] runner 能力宣告（`parse` / `validateDoD` / `iterate` 為 false）隨記錄一起持久化並在 UI 可見
- [ ] 外部 CLI 成功仍不得被呈現或記錄為 Definition of Done 已達成
- [ ] 外部 CLI 的工具事件對應到宣告的卡片型別；無法對應者退回通用卡
- [ ] Seam 1 smoke：一次外部 CLI run 的帳本形狀與內建一致，且能力宣告仍為 false
