# 04 — Acceptance Gate 首條完整路徑

**What to build:** 讓 turn answer 與 file-content criteria 經 Host-owned checker、trusted evidence、AcceptanceSnapshot 到 terminal Goal outcome 完成第一條 acceptance-driven vertical slice。

**Blocked by:** 03 — Goal Contract admission 與 fail-closed.

**Status:** ready-for-agent

- [ ] assistant-answer-present 僅適用 turn mode，answered 與 Goal passed 不再隱式等價。
- [ ] file-content criterion 以 immutable content digest evidence 驗證，後續內容漂移會 invalidated。
- [ ] 每次 check 產生 immutable AcceptanceSnapshot，passed 必須引用 acceptance digest。
- [ ] Model 自稱完成但 checker failed 時不得產生 passed verdict。

