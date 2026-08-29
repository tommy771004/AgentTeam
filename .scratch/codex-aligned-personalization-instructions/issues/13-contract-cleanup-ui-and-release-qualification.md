# 13 — Contract cleanup、UI 與 release qualification

**What to build:** 在所有 vertical slices 可運作後，收掉 legacy resolver／persistence compatibility seam，完成 Codex-aligned Personalization 的端到端 UI、可及性與 release 證據；最後產品只有一個 instruction discovery owner、一個 Personalization editor 與一個可由 Turn Record 稽核的 run snapshot contract。

**Blocked by:** 03 — 舊個人化資料遷移與重複 UI contraction; 06 — 有界且安全的本機 include resolution; 07 — 原子專案指令建立與編輯; 08 — Revision events 與 run snapshot isolation; 09 — Instruction budget、去重與 context usage; 10 — 個人化 export、import 與 recovery; 11 — 外部 CLI instruction delivery modes; 12 — Outbound 與 instruction authority 安全 qualification.

**Status:** 可交給代理

- [x] Production renderer-owned instruction discovery／prompt assembly、legacy writes 與重複 Learning editor 全部刪除；plain-browser degradation 不得被誤用為 Electron authority。
- [x] Drift guards 證明只有 Pi Host/resource discovery 解析 production instructions，Instruction Repository 與 DurableMemoryStore 仍是不同 authority。
- [x] Personalization 完整呈現人格、全域自訂指令、project sources、effective order、include tree、revision、hash、budget 與 delivery mode，但不以重複裝飾性 chips 製造資訊噪音。
- [x] Save、open、create、conflict、include error、degraded recovery 與 next-run lifecycle 都有清楚、可鍵盤操作且不依 entrance animation 才可見的狀態。
- [x] Desktop 與 narrow layout 無文字貼邊、裁切、錯位、不可讀對比或假互動；所有控制以真實 pointer/keyboard 操作驗證。
- [x] Real Pi Host end-to-end qualification 從 UI save 到 Task run、Loop iteration、Turn Record、restart/replay 全部通過。
- [ ] Full build、focused instruction smoke、full smoke chain 與 applicable real CLI qualification 綠；未取得的外部真機證據明確列為 blocked，不偽造通過。
- [ ] 規格 acceptance、tracker status、DEV_STATE、架構文件與 qualification evidence 完成一 hop 對帳後，才可把 effort 標為 resolved。
- [ ] 交付前逐點重讀並執行 repository anti-slop design law 的完整 UI 複查，修正所有發現後留下證據。
