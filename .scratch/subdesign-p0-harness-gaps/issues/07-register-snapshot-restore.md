# 07 — Register 快照 + restore 成新 revision + live guard

**What to build:** Artifact store 每次 register 成功時，自動為該 revision 保存完整檔案快照（entry + supportingFiles + sha256 manifest），存於 project-relative workspace store 並遵循既有大小/數量上限模式。使用者可一鍵還原到任一舊 revision——還原以「新 revision」呈現（歷史 append-only、不可改寫）。該 brief 的 run 為 live 時，restore 與其他寫性操作被 controller 拒絕（沿用既有 live 判定與 busy failure 型別）。無快照索引的舊 artifact 載入不報錯，僅對其停用還原。使用者得到的改變：AI 改壞了可以退回。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Register 成功即產生 per-revision 快照索引（revision → { files: {path, sha256}, createdAt }）
- [ ] Restore 以舊快照內容建立新 revision；原始 revisions 永不被覆寫
- [ ] Run live 中 restore 被拒絕，錯誤型別與現行 busy failure 一致
- [ ] 無快照的舊 artifact 相容：載入正常、還原停用但不報錯
- [ ] Store-level smoke：快照索引、sha256 正確性、restore 內容等價、live 拒絕四條路徑
