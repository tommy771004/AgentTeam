# 05 — Summary compaction + preflight 觸發

**What to build:** 長任務接近 context 上限時自動整理前段脈絡:每個 turn 送出前做 preflight 檢查,超出閾值時對早期 turn 做摘要式替換(現有三層截斷仍為第一道閘,compaction 是其後的第二道)。壓縮事件(何時壓、涵蓋範圍)寫入 run journal,壓縮前的完整原文留在 durable checkpoint 供事後回查。UI Projection 新增 compaction marker:一行可展開的標記,讓使用者知道「前面有內容被收納了」而不是 agent 憑空接續。

**Blocked by:** 03 — Durable checkpoint storage(壓縮前原文需要權威儲存)

**Status:** ready-for-agent

- [ ] preflight 在每個 turn 送出前檢查估算 token 量,超閾值觸發 compaction
- [ ] 截斷層先於 compaction:未達摘要閾值前行為與現況相同
- [ ] 壓縮器以介面注入,預設實作走既有 LLM provider
- [ ] journal 記錄每次壓縮事件(時間、範圍)
- [ ] 壓縮前原文可從 checkpoint 取回
- [ ] UI 出現可展開的 compaction marker item kind
- [ ] 測試:超量 context 輸入 → 斷言觸發、journal 事件、marker、原文可回查
