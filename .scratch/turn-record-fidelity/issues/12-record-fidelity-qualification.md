# 12 — Record fidelity qualification

**What to build:** 一條把整件事釘死的驗收鏈：五種結算彼此可區分、歷史跨 Host 重啟連續、renderer reload 後由 Host 重建、外部 CLI 與內建同形、長跑的完整執行過程可分頁讀回。這一票不加新功能，它證明前十一票合起來真的成立 —— 並且讓「先前那個把開場白當結論發布的缺陷類別」在 CI 層級無法復發。

**Blocked by:** 10, 11

**Status:** done

- [x] 一條 qualification smoke 鏈涵蓋：`answered` / `empty` / `interrupted(user)` / `interrupted(timeout)` / `failed` / `cancelled` 各自可區分
- [x] 涵蓋 Host 重啟後歷史連續、renderer reload 後由 Host 重建
- [x] 涵蓋外部 CLI 與內建 run 的帳本同形，且能力宣告差異仍在
- [x] 涵蓋超過舊記憶體上限的長跑，完成後執行過程可分頁完整讀回
- [x] 涵蓋多段 assistant 的回合結算在最後一段（原始缺陷的 regression）
- [x] 所有新 smoke 匯入實際出貨模組，不得就地重寫被檢查的邏輯，也不得為了讓 import 成功而加 loader 相依
- [x] 掛進 smoke chain；`npm run build`、`npm run smoke`、`npm run smoke:pi-host` 全綠

## Comments

**Qualified.** One chain drives a real Host and asserts the whole effort holds together: all six settlements distinguishable (including `interrupted:user` vs `interrupted:timeout`, driven by a real stop and a real turn budget), history continuous across a Host restart, a renderer reload rebuilding the same answer through `projectPiSession`, a 24-turn run read back in full past the old 120-event cap with no gap or repeat across page boundaries, external parity with its capability declaration intact, and the originating defect as a regression.

**It found a real gap, which is what a qualification is for.** The record kept only the *settled* answer, so everything the model said on the way there — the opening narration — was not reconstructable from it. The narration reached the feed as events, but ADR-0049 says model-visible output must be reconstructable from the record, and it was not. Each assistant message is now recorded at its own `message_end`, so the narration keeps its place **before** the tool it preceded; the settled answer only stands in when the stream carried no assistant message at all (the delta-rebuild path). `conversationAnswer` still returns the last assistant row, so the original defect stays closed.

Two smokes' history assertions grew a row as a result. They were updated to the fuller record, not weakened — the model's history now contains the narration, the tool call, the tool result and the conclusion, in the order they happened.

**Note for whoever picks this up next:** the long-run scenario needed 24 turns to clear 120 entries, which is a reminder that the old in-memory cap was roughly three turns of real work.
