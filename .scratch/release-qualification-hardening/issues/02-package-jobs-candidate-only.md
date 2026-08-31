# 02 — Package jobs 改為 candidate-only

**What to build:** 讓每個平台 package job 只建立、驗證並保存私有 candidate artifacts；在 Paid Beta qualification 前，任何失敗路徑都不能寫入 customer-facing update channel。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Package matrix 不再持有或使用 customer-facing update publish credential。
- [ ] Signed manifest 與 installers 只上傳至 CI artifact storage，仍可供後續 gate 下載。
- [ ] Workflow contract test 證明 package success 加 qualification failure 造成零 remote publish requests。
- [ ] Build、package、signing、notarization 與 lifecycle evidence 的既有 fail-closed 行為保持不變。
