# 09 — Archive 詳情匯出入口

**What to build:** RecordsPage 封存詳情 modal 加入「匯出報告」：與摘要卡入口共用同一匯出動作（組束→序列化→落地），從 ArchiveRecord 出發（journal join 缺件時走降級文件），CLI run 標章顯示與摘要卡一致。

**Blocked by:** 08

**Status:** 可交給代理

- [ ] 封存詳情出現匯出動作，共用 08 的匯出流程
- [ ] journal 缺件時降級文件（標記生命週期資料不完整）
- [ ] 元件測試：入口與降級路徑
