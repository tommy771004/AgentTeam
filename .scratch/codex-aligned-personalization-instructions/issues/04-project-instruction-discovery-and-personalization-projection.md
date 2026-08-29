# 04 — 專案指令 discovery 與 Personalization projection

**What to build:** 在同一「個人化」畫面顯示目前專案真正由 filesystem 提供的 AGENTS／CLAUDE sources，讓 Host-owned resolver 將它們加入有效 run snapshot，並保持檔案是 Git、IDE、worktree 與原生 CLI 可見的 canonical source。

**Blocked by:** 02 — 全域指令 run snapshot 與 Turn Record.

**Status:** 可交給代理

- [x] Pi Host/resource discovery 成為 production project-instruction resolver；renderer 不再組裝一份行為等價的 production prompt。
- [x] Personalization projection 顯示目前 project root 找到的 source kind、canonical path、bytes、hash、revision 與 truncation/error summary。
- [x] Global instructions 先組裝，project instructions 後組裝；衝突說明清楚區分 assembly order 與 authority order。
- [x] Project file body 維持 filesystem canonical，SQLite 索引不可成為能覆寫檔案的 shadow copy。
- [x] Task run snapshot 與 Turn Record 記錄實際使用的 project sources 及 effective text。
- [x] 切換 project/worktree 後 projection 與下一個 run 使用新 project identity，不殘留前一專案指令。
- [x] 使用者可從 source row 開啟 canonical file；本票不提供隱式建立或寫回。
- [x] Real Host smoke 以 temporary project 驗證 global + project delivery、Git-compatible file authority、project switch 與 record provenance。
