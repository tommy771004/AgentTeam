# 12 — Outbound 與 instruction authority 安全 qualification

**What to build:** 證明 Personalization 只是 model-visible instruction，不是新的權限通道：global、project 與 included content 在 builtin／external runner 都經 Outbound Data Gate，不能改寫 Approval Decision、工具 capability、managed policy 或執行證據，temporary/unattended lifecycle 也維持既有安全語意。

**Blocked by:** 11 — 外部 CLI instruction delivery modes.

**Status:** 可交給代理

- [x] Protected Data 出現在 global、project 或 included source 時，所有有效 deployment posture 都依既有 Outbound Data Gate sanitize／block contract 處理。
- [x] Mandatory company protection 不可被 UI setting、自訂指令文字、import bundle 或 project override 降級。
- [x] Instruction 不能改變 Approval Mode、跳過 capability-required approval、授予 tool、放寬 sandbox 或產生 Host execution evidence。
- [x] Managed/system policy 與 project/global/memory authority order以衝突 corpus 驗證，且 UI 說明與實際結果一致。
- [x] Temporary chat 仍套用 explicit instructions，但不讀寫 durable memory；unattended run 的 HITL timeout／auto-deny 語意不變。
- [x] Include authorization metadata不送進模型當作可偽造 authority；只有 Host resolution result 能標示 applied source。
- [x] Turn Record 將 user-authored content、Host resolution fact、model claim 與 execution evidence 保持不同 accountable classes。
- [x] Real provider-preparation smoke 與攻擊型 fixtures 覆蓋 prompt injection、path escape、protected content、approval bypass claim 與 fake evidence。

Non-external qualification evidence：`scripts/smoke-instruction-safety-qualification.mts` 已覆蓋 builtin provider-preparation 與上述攻擊 fixtures，並由 `smoke:instructions` 執行；external CLI／真機路徑仍待 issue 11，因此最後一項暫不標記完成。
