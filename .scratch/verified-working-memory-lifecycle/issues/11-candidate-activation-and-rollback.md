# 11 — Component-local candidate、activation 與 rollback

**What to build:** 讓 maintainer 能從 active Memory-Control Package 建立只修改被診斷 component 的 candidate，保留 lineage，在驗證後原子啟用，並能回滾到先前 active revision。

**Blocked by:** 10 — Active Memory-Control Package 綁定 Task run

**Status:** 完成

- [x] Candidate 必須聲明 diagnosis component，且只接受 schema-valid、bounded JSON Patch。
- [x] 未被診斷的三個 component digests 必須與 parent 完全相同；任何額外變更拒絕建立 candidate。
- [x] Candidate 建立、驗證中與 rejected 狀態不影響 active package 或已 admission 的 runs。
- [x] Activation 原子切換 active revision；同一 admission 不能觀察到混合 components。
- [x] Rollback 原子選回一個既有可驗證 revision，不以覆寫或修改歷史 package 實現。
- [x] Lineage 與 bounded activation/rejection reason 可經 Host interface 與 Turn Record 稽核。
- [x] Candidate isolation、digest tampering、activation race 與 rollback smoke 已加入實際 smoke gate。
