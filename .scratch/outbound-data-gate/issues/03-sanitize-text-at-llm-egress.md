# 03 — 在 LLM 出站執行文字基礎淨化

**What to build:** 在保護啟用時，使用不可移除的 deterministic baseline 與有效 Provider Security Profile，將 prompt、對話歷史、附件文字、系統內容及工具結果中的 Protected Data 轉成保留定位的 Protected Exclusion，讓 fake 或真實 LLM 只收到安全文字，其餘任務仍可繼續。

**Blocked by:** 02 — 建立 Provider Security Profile

**Status:** resolved

- [x] baseline 至少偵測常見 API key、token、password、private key、connection string、cloud credential 與 secret-bearing field names。
- [x] baseline 至少偵測台灣身分證/居留/護照型態、電話、email、信用卡 Luhn 與常見銀行欄位。
- [x] `.env`、credential、secret、key 與 certificate 等敏感路徑具有不可由 policy 或 provider supplement 關閉的最低規則。
- [x] Company Base Policy 可增加公司名稱、內部專案詞、姓名、地址與其他 context-specific 規則。
- [x] prompt、history、system message、attachment text 與 tool result 都在每次 LLM transport 前重新組裝為安全 payload。
- [x] Protected Exclusion 使用固定非敏感 marker 並保留 virtual source 與 line range；原始受保護文字不進入送出 payload。
- [x] 安全區段會繼續送出；只有無法建立或執行 mandatory baseline 時才阻擋受影響的 outbound call。
- [x] `required` 的 Task run 在 admission 釘選 policy bundle；active `optional` 在每次 outbound call 取得當前有效 policy。
- [x] 阻擋或降級結果提供不含受保護內容的使用者說明，桌面應用與本機非 AI 功能不中斷。
- [x] fake LLM scenario 對每種來源做正向與負向斷言，並掃描實際 transport payload 確認 synthetic secrets/PII 未出現。


## Answer

- `textSanitize.ts`：`PROTECTED_EXCLUSION_MARKER`、`sanitizeTextWithProfile`、`sanitizeChatMessages`；baseline detectors（key/password/PEM/email/TW phone/Luhn card 等）+ company extra detectors。
- 排除紀錄僅 source + line range + detectorId。
- `chatCompletionWithTools` 在 protection active 時先 sanitize messages 再 `inspectOutbound`。
- required 若無法建立 baseline 則 block 該次 outbound。
- smoke-text-sanitize（6）掛入 smoke / smoke:ci。

