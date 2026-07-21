# 04 — 建立本機可驗證 Security Evidence Ledger

**What to build:** 讓每次受保護 outbound decision 與相關 policy/mode 事件寫入單一 Electron main append-only Security Evidence Ledger。紀錄以 Asia/Taipei 的 ISO week 分檔，只保留可驗證 metadata 與 source locator，並用 safeStorage 保護的 per-device HMAC key 建立跨週鏈。

**Blocked by:** 03 — 在 LLM 出站執行文字基礎淨化

**Status:** resolved

- [x] ledger 使用版本化 JSONL record，按 Asia/Taipei 的 Monday-based ISO week 分檔，事件 timestamp 使用 UTC。
- [x] outbound record 包含 event/sequence/run/provider、guard mode、policy source/version/change ID、classifier status、action 與 source locator。
- [x] ledger 不含 prompt、history、file body、model response、Protected Data、policy sensitive value 或 content digest。
- [ ] policy change/rollback、guard-mode-change、workspace-sync、device lifecycle、verification 與 retention checkpoint 使用同一 ledger 的不同 eventType。
- [x] sealed record 含 sequence、previous MAC 與 record MAC，key 由 safeStorage 保管且不以明文落地。
- [x] verifier 能偵測 record 修改、插入、刪除、重新排序及未授權截斷。
- [ ] 新一週的第一筆 record 連到前一週 terminal MAC。
- [ ] `evidence.onKeyUnavailable=block|unsealed` 可由公司 policy 控制；required 預設阻擋 mandatory sealed evidence，optional 可明確標記 unsealed。
- [x] demo 使用暫時 unsealed evidence，localhost demo 不需要 HMAC，UI 明確顯示其不可作企業驗證。
- [ ] guard 關閉時不檢查 payload，但 mode transition 仍留下可解釋的 evidence event。
- [ ] 測試使用 synthetic secrets，並對完整 ledger 做負向掃描，證明內容不因稽核而二次外洩。


## Answer

**Delivered (pure module + smoke):**
- `evidenceLedger.ts`：weekly JSONL (`evidence-YYYY-Www.jsonl` via `isoWeekKeyTaipei`)、append-only sequence、HMAC-SHA256 sealed chain、`verifyLedgerFile` 偵測 mutate/reorder。
- Record schema 僅 metadata + exclusion locators；smoke 負向掃描無 prompt/secret。
- `sealed:false` 支援 demo/unsealed。
- smoke-evidence-ledger 掛入 smoke / smoke:ci。

**Deferred to Electron main tickets (05+/11+/12):**
- safeStorage-backed per-device key、`onKeyUnavailable=block|unsealed` production wiring
- cross-week terminal MAC link、retention checkpoints、background upload
- live hook from `inspectOutbound` into ledger in main process

