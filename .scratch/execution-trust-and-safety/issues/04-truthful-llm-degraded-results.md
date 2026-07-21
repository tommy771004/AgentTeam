# 04 — 讓 LLM 降級結果保持誠實

Status: resolved
**What to build:** 當模型、傳輸或 Definition of Done 驗證失敗時，使用者能明確看到失敗、降級或 simulation，而不是被 synthetic output 或隨機 confidence 告知任務成功。只有具可信執行證據的 Loop run 才可宣稱完成並觸發 success-only 後續行為。

**Blocked by:** None — can start immediately.

- [x] 已驗證成功、明確 simulation 與 LLM/DoD 降級結果在 run presentation 與 Archive 中可區分。
- [x] 已設定 LLM 的失敗不會讓步驟、Turn 結果或 Goal-based DoD 進入 `success`。
- [x] 降級與 simulation 結果不會觸發 success Learning、成功通知或成功 Archive 語義，且保留可診斷的失敗原因與 retry path。
- [x] 外部行為 fixture 覆蓋 LLM transport failure、malformed DoD verdict、explicit simulation，並證明三者不會被誤報為已達成 Definition of Done。

## Comments

### 2026-07-16 — TDD: executionEvidence honesty

- Seam: pure `executionEvidence.ts` (`canClaimDodSuccess` / `canTriggerSuccessSideEffects` / `resolveTerminalStatus` / archive mapping).
- Bugs fixed:
  - LLM step failure no longer falls back to synthetic step success.
  - DoD unparsable no longer falls back to confidence-based success.
  - Offline simulation cannot claim DoD / success Learning.
- Engine stores `state.executionEvidence`; Archive persists it; simulation → archive `warning`, degraded → `failed`.
- Tests: smoke-prod-modules pure contract; smoke-caps source wiring (no fallback-to-simulation success path).
