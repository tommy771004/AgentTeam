# 05 — 階層 override 與 fallback discovery

**What to build:** 將 project instruction discovery 擴充成 Codex-aligned hierarchy：由廣到窄解析 parent、project root 與目前 work directory，在每一層套用 override／normal／bounded fallback 規則，使較近的具體指令能可預測地優先，而且使用者能看到完整來源鏈。

**Blocked by:** 04 — 專案指令 discovery 與 Personalization projection.

**Status:** 可交給代理

- [x] Resolver 從受限 parent/project boundary 走到目前 work path，來源順序穩定且不跨越 canonical repository boundary。
- [x] 同一 directory 的 override、normal 與 fallback 選擇規則明確、互斥且由 Host 單點實作。
- [x] 較近 directory source 的 authority 高於較廣 project source，global custom instructions 保持較低的 user-default 層。
- [x] Configured fallback filenames 只接受 bounded safe basenames，不接受 path、glob、空字串或重複名稱。
- [x] Personalization 顯示每個 source 的 scope、相對層級、是否被 override／shadowed，以及最終 effective order。
- [x] Run snapshot 綁定實際 work path；同一 project 不同工作目錄可得到不同但可稽核的 snapshot。
- [x] Missing optional layer 不製造空白規則，unreadable selected source 回傳 visible typed diagnostic。
- [x] Resolver corpus 覆蓋 parent/root/subdirectory、override、fallback、Git boundary、worktree 與衝突內容，並透過 public snapshot contract 驗證。
