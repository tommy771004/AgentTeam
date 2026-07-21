# 23 — Security Evidence 僅 Main 於真實出站點寫入

**What to build:** Security Evidence Ledger 的 outbound-decision 等 privileged append 改由 **main** 在真實控制點寫入；renderer IPC 不得偽造。

**Blocked by:** 16, 19, 20

**Status:** resolved

- [x] `allowEvidenceAppendFromIpc` 拒絕 outbound-decision 等 privileged types。
- [x] main IPC `fromIpc: true`。
- [x] main prepare view + CLI sandbox deny 內部 append。
- [x] coordinator 移除 renderer appendEvidence for restricted-view。
- [x] metadata-only（既有 ledger 契約）。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · ADR-0015

## Answer

- `allowEvidenceAppendFromIpc` in evidenceLedger
- prepareOutboundRunView / cli:runAgent deny → main append
- renderer IPC cannot spoof outbound-decision
