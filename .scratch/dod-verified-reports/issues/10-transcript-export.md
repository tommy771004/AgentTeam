# 10 — Run transcript 匯出

**What to build:** 把 run 的分組執行紀錄（context 收集、工具操作、檔案變更、sub-agents、日誌尾部）匯出為可離線閱讀的文件，與驗證報告共用序列化與儲存縫隙，供留存與重播審視。資料來源為 ThreadRunSummary（持久化摘要），不依賴 ephemeral 的即時活動。

**Blocked by:** 05, 06

**Status:** 可交給代理

- [ ] transcript 文件模型節區（分組操作、檔案變更、diff 摘錄）
- [ ] 匯出動作（與報告入口並列，格式/落地共用）
- [ ] smoke：transcript 序列化 fixture（含分組與無操作 run 的降級）
