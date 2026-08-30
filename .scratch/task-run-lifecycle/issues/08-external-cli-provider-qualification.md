# 08 — External CLI provider qualification matrix

**What to build:** 對每個支援的 External CLI provider 產生誠實、可重跑的真實環境 qualification，讓缺 credential、binary 或平台能力不會被 fixture 綠燈掩蓋。

**Blocked by:** 07 — External CLI durable lifecycle contract integration；external-cli-durable-harness #07

**Status:** 可交給代理

- [ ] Codex、Claude、Grok、Gemini 與 Cursor 分別記錄 binary、auth、connector、session 與平台前置條件
- [ ] 每個 provider 結果固定為 qualified、blocked-auth、unavailable 或 unsupported，不使用模糊 pass/fail
- [ ] 可用環境驗證長時間活動、idle/absolute bounds、wait/auth、cancel、process loss 與 retry refusal
- [ ] fixture 與 fake clock 僅證明 contract，不被引用為真機 qualification
- [ ] qualification report 能一 hop 指向 command、baseline 與輸出證據
