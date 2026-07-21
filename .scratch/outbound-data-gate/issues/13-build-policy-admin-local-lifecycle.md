# 13 — 建置 Policy Admin 與本機政策生命週期

**What to build:** 以 `SUBAGENTS_BUILD_FLAVOR=standard|policy-admin` 在編譯期決定是否包含政策管理面。Policy Admin 可建立與驗證 local policy drafts、明確啟用新版本、執行產生新版本的 rollback，並顯示不含敏感值的變更摘要；它仍使用相同 Outbound Data Gate 且不能查看 Protected Data。

**Blocked by:** 02 — 建立 Provider Security Profile；04 — 建立本機可驗證 Security Evidence Ledger

**Status:** resolved

- [x] unset build flavor 產生 standard，明確 `policy-admin` 產生管理版本，其他值使 build 失敗。
- [x] compiled flavor 是 immutable runtime constant，並顯示於 About 與 Settings。
- [x] standard artifact 不包含 policy editing、activation、publishing 或 evidence verification 管理 surface。
- [x] Policy Admin 只編輯 draft，不能直接覆寫 active or last-known-good policy。
- [x] activation 前執行 schema、provider identity、monotonic merge 與 synthetic fixture validation。
- [x] save draft 與 activate 是不同明確動作；validation failure 保留 active version 並提供不含 Protected Data 的原因。
- [x] rollback 建立新的 monotonically increasing version，記錄 target、reason 與 relationship，版本號不倒退。
- [x] change summary 顯示 rule IDs、field names、reason 及新增/收緊/rollback 類別，不顯示 protected/policy sensitive values。
- [x] policy change 與 rollback 事件寫入同一 Security Evidence Ledger，完整 policy versions 留在 policy store。
- [x] standard 與 policy-admin 保持相同 app identity、product identity、artifact family 與 update channel。
- [x] possession of Policy Admin artifact 是 v1 管理權限；產品文件明確說明沒有 runtime admin auth/RBAC 的部署風險。
- [x] 兩種 build 的 scenario 證明同一 protected payload 得到相同 enforcement，Policy Admin 無 bypass 或 plaintext view。


## Answer

- `policyAdmin.ts`: draft ≠ active; activate validates schema/identity/monotonic; rollback creates new version; build flavor standard|policy-admin surfaces gate.
- smoke-outbound-phase2.

