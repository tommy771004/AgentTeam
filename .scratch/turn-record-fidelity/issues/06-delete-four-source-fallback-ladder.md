# 06 — 刪掉執行過程記錄的四層 fallback 梯子

**What to build:** 「這次跑了什麼」只有一個答案。目前執行過程記錄是四種形狀依序 fallback 拼出來的（live activity → Host 工具稽核 → run 的 toolCalls → steps 加 logs），四者都不權威、也無法互相證偽。改成只從 Turn Record 推導。連帶地，那個 ephemeral 的 live activity store 退回它該有的角色 —— 進行中的畫面快取 —— 不再是任何持久化內容的輸入，於是它的 120／40 上限只約束快取，永遠不可能截掉歷史。

**Blocked by:** 05（功能已由 commit 7191bd3 落地）

**Status:** done

- [x] 執行過程記錄只從 Turn Record 推導，四層 fallback 梯子刪除（是刪除，不是重排優先序）
- [x] live activity store 不再是任何持久化內容的輸入；其事件上限只約束記憶體快取
- [x] 超過舊上限的長跑（>120 事件）在完成後仍可完整讀到執行過程
- [x] 執行過程列的排序由 `seq` 決定
- [x] Seam 2 smoke：以長帳本 fixture 斷言不因任何上限而遺失條目
- [x] Seam 1 smoke：一次超過舊上限的回合，完成後記錄完整
