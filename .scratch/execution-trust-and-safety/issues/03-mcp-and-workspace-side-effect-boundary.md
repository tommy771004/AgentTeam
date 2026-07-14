# 03 — 封住 generic MCP 與唯讀 workspace 的副作用漏洞

Status: 可交給代理

**What to build:** 讓 generic MCP 呼叫依真正目標工具判斷副作用與核准需求，而不是因 wrapper 名稱被誤判為安全；同時讓 workspace list 在任何模式下都保持真正唯讀。使用者在預設或無人值守情境下，不會因隱藏寫入而修改外部系統或專案工作區。

**Blocked by:** None — can start immediately.

- [ ] Generic MCP call 依目標 server tool 的 metadata 或保守名稱分類決定 read/write，而非僅依外層名稱。
- [ ] 預設 auto/always 模式的 MCP 寫入在傳輸前要求核准；無人值守工作無法靜默通過該核准。
- [ ] 明確 full-access 行為保持可追溯，而 deny precedence 與無人值守降級規則不被改變。
- [ ] Workspace list 對不存在路徑回傳可理解的 not-found 結果，且測試證明檔案系統完全不變。
