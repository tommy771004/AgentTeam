# 07 — Direct protocol 與 Code Mode 遷移共用決策

**What to build:** Direct protocol 與 Code Mode nested calls 使用 surrounding turn 的同一 contract revision、active set 與 policy/evidence module。使用者不會因入口不同得到不同 validation 或 approval 結果，`run_code` 也不能替 nested side effect 洗掉核准。

**Blocked by:** 03 — Capability load 更新 Turn Tool Contract revision; 04 — Legacy translation fixture 與 direct protocol validation; 06 — Policy and Evidence module 擴展切片.

**Status:** 可交給代理

- [x] Direct calls 以 session contract 驗證 tool existence、activation、schema 與 policy。
- [x] Code Mode 只能呼叫 surrounding turn active contract 中的工具。
- [x] Outer `run_code` approval 不被 nested calls 繼承，每個 effectful nested call 產生自己的 Approval Decision。
- [x] Direct 與 nested origins 都帶正確 runId、callId、parentRunId、contract revision 與 schema digest。
- [x] Inactive、stale revision、invalid args、ask、deny、cancel 與 success 在兩個 origins 有一致 settlement vocabulary。
- [x] Code Mode 無法透過直接指定未啟用名稱或舊 schema digest 繞過 progressive disclosure。
- [x] 真實 Host qualification 同時覆蓋 direct、Pi-originated 與 Code Mode nested 的等價決策結果。

## Comments

Implemented and independently verified. Contract-bound direct builtin/pack calls and Code Mode nested calls now share current-contract validation and the frozen Host policy/evidence seam. Code Mode re-enters protocol routes with a private origin marker and never injects nested approval; active names are snapshotted from the surrounding contract. The qualification matrix covers success, invalid arguments, ask, deny, cancel, inactive tools, and stale revisions for both direct and nested origins, including coordinates and structured-failure settlement. `npm run smoke:pi-direct-code-policy` and `npm run build` pass.
