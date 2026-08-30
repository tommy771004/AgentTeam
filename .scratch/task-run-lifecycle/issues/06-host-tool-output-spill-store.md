# 06 — Host ToolOutputSpillStore 單一 authority

**What to build:** 大型 Pi、builtin shell 與 external CLI 輸出使用同一個 Host-owned spill contract；renderer 只取得 bounded locator 與頁面，不承載 raw output 或第三套 authority。

**Blocked by:** 05 — Finalization claim retry、release 與 drain

**Status:** 可交給代理

- [ ] 現有 attachment/spill functions 收斂為單一 write、readPage、authorize、dispose、TTL 與 restart-GC interface
- [ ] locator 綁定 run、session、thread 與 project identity；cross-run 或跨 project 讀取 fail closed
- [ ] readPage 有 byte/round bounds，且取回內容再次通過 Outbound Data Gate
- [ ] Pi pack、builtin bash 與 external output 使用一致 envelope；plain-browser 路徑明確標示 non-canonical
- [ ] bounded paging、unauthorized locator、dispose、TTL 與 restart orphan cleanup 有 shipped-module smoke
