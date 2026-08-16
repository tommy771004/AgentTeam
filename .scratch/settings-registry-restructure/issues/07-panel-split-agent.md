# 07 — 拆檔批次 B：代理群組 panel

**What to build:** 代理群組各節搬成獨立 panel，包含這個檔案裡最大的兩塊（組態、角色模型）以及 CLI 授權矩陣與 OpenCode 匯入報告。複雜工作流不被拆散——它們整塊搬家，內部流程原封不動。使用者這一側完全無感。

**Blocked by:** 04

**Status:** 可交給代理

- [ ] 代理群組各節搬成獨立 panel 元件
- [ ] CLI 授權矩陣、OpenCode 匯入報告、角色模型指派整塊搬移，內部流程未被重寫
- [ ] Policy Admin 與 Pi Core 既有的專屬面板不動其內部
- [ ] 每節搬完各跑一次 `npm run build` 與 smoke
- [ ] 欄位順序、標籤、預設值、互動行為與搬移前逐項相同
