# 04 — 建立本機可驗證 Security Evidence Ledger

**What to build:** 讓每次受保護 outbound decision 與相關 policy/mode 事件寫入單一 Electron main append-only Security Evidence Ledger。紀錄以 Asia/Taipei 的 ISO week 分檔，只保留可驗證 metadata 與 source locator，並用 safeStorage 保護的 per-device HMAC key 建立跨週鏈。

**Blocked by:** 03 — 在 LLM 出站執行文字基礎淨化

**Status:** resolved

- [x] ledger 使用版本化 JSONL record，按 Asia/Taipei 的 Monday-based ISO week 分檔，事件 timestamp 使用 UTC。
- [x] outbound record 包含 event/sequence/run/provider、guard mode、policy source/version/change ID、classifier status、action 與 source locator。
- [x] ledger 不含 prompt、history、file body、model response、Protected Data、policy sensitive value 或 content digest。
- [x] policy change/rollback、guard-mode-change、workspace-sync、device lifecycle、verification 與 retention checkpoint 使用同一 ledger 的不同 eventType。
- [x] sealed record 含 sequence、previous MAC 與 record MAC，key 由 safeStorage 保管且不以明文落地。
- [x] verifier 能偵測 record 修改、插入、刪除、重新排序及未授權截斷。
- [x] 新一週的第一筆 record 連到前一週 terminal MAC。
- [x] `evidence.onKeyUnavailable=block|unsealed` 可由公司 policy 控制；required 預設阻擋 mandatory sealed evidence，optional 可明確標記 unsealed。
- [x] demo 使用暫時 unsealed evidence，localhost demo 不需要 HMAC，UI 明確顯示其不可作企業驗證。
- [x] guard 關閉時不檢查 payload，但 mode transition 仍留下可解釋的 evidence event（`buildGuardModeChangeEvidence` + settings hydrate）。
- [x] 測試使用 synthetic secrets，並對完整 ledger 做負向掃描，證明內容不因稽核而二次外洩。

## Answer

**Pure + smoke:**
- `evidenceLedger.ts`：weekly JSONL、HMAC chain、`previousIsoWeekKeyTaipei` cross-week link、`decideSealedEvidenceWhenKeyMissing`、`buildGuardModeChangeEvidence`、multi eventType、verify 允許 seq1 外週 previousMac。
- smoke-evidence-ledger：10 tests。
- settings hydrate 在 deploy 變更時 append `guard-mode-change`（metadata）。
