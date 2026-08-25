# 15 — Parity 證明與移除：workspace_write 與 bash

**What to build:** 寫檔與執行 shell 這兩件事，各自只剩一份實作。這兩個比唯讀那組風險高得多（一個會改檔案、一個會執行任意指令），所以單獨成票。

**ADR-0047 的約束必須存活**：builtin `bash` 在 Outbound Guard `required` 之下是 fail-closed 的，且它**不**在 external CLI 的 sandbox 範圍內（ADR-0022 隔離的是 external CLI）。合併前要證明這個性質沒有在移除過程中被弄丟。

**Blocked by:** 09, 14

**Status:** 可交給代理

- [x] `workspace_write` → `write` 與 `bash` → `bash` 各自逐項證明 parity（schema、成功、錯誤、streaming、取消、專案範圍、session recording）
- [x] `write` 參與既有的 per-file mutation queue
- [x] `bash` 在 Outbound Guard `required` 下維持 fail-closed（ADR-0047），且不被誤納入 external CLI sandbox 範圍
- [x] 危險／不可分割的指令仍然一律 ask（既有 `bashRequireAsk` 語意）
- [x] parity 通過後刪除兩個 renderer 工具與其註冊
- [x] 測試在單一接縫，含 Outbound Guard `required` 的 fail-closed 斷言
