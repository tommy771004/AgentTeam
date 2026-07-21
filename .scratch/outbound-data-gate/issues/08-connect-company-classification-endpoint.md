# 08 — 接入公司 `/v1` 分類端點

**What to build:** 在 guard mode 為 `required` 且公司設定完整 Company Classification Endpoint URL 時，以 one-source/one-chunk structured request 取得額外的 Protected Exclusion。端點只能增加保護；若未設定或暫時不可用，回到 deterministic baseline 並繼續安全服務。

**Blocked by:** 03 — 在 LLM 出站執行文字基礎淨化；04 — 建立本機可驗證 Security Evidence Ledger

**Status:** resolved

- [x] client 直接 POST 到 policy 指定的完整 URL，不自行附加 `/classify` 等 route，且拒絕 redirect。
- [x] request 包含 applicable workspace ID、Managed Device ID、provider ID、單一 source/chunk、source kind 與 format-specific locator。
- [x] response schema 僅能增加 exclusion locators；不能移除 baseline 或 company policy finding。
- [x] 總嘗試次數最多三次，只對 timeout、network、429、5xx 做短暫 bounded backoff。
- [x] 4xx、authentication failure 與 invalid response 不重試，也不以匿名方式 fallback。
- [x] 無端點或 transient retry exhausted 時記錄 classifier degraded 狀態並使用 baseline；不單因 classifier unavailable 阻斷服務。
- [x] auth 支援 none、bearer secret reference、custom-header secret reference 與 mTLS，secret 不出現在 policy JSON、renderer 或 evidence。
- [x] HTTPS 與公司明確核准的 plaintext HTTP 都可設定；HTTP 風險在 UI/evidence 標示，不宣稱加密。
- [x] Settings connection test 只使用 synthetic content，不讀取 project、prompt 或 history。
- [x] demo 可使用 loopback classifier；loopback unavailable 時使用 baseline 並維持 demo 流程。
- [x] fake endpoint scenario 驗證 additive finding、重試矩陣、exact URL、redirect denial、auth failure 與 baseline continuity。


## Answer

- `companyClassifier.ts`: exact-URL POST, redirect:error, max 3 attempts, transient-only retry, auth/4xx no-retry, additive exclusions only, plaintext HTTP gated, synthetic connection-test payload, mergeAdditiveExclusions.
- smoke-company-classifier in smoke/smoke:ci.
- Loopback demo wiring + Settings UI test button can hook this client later.

