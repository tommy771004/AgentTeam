# 12 — Critical release hardening qualification

**What to build:** 將安全發布、main-only credentials、settings durability 與 blocking repository guards 接入既有 Paid Beta qualifier rollup；自動 contract 全綠時仍須對缺少的外部 signed-platform evidence 誠實輸出 NO-GO。

**Blocked by:** 03 — Verified channel promotion；07 — Legacy raw-secret contract removal；08 — Atomic settings persistence；10 — Merge-base complexity qualification；11 — Shipped-runtime CI coverage。

**Status:** 已完成

- [x] Qualifier 只消費 owning seams 的可信 receipts，不在 rollup 內重做或偽造下層結果。
- [x] Release promotion、credential boundary、settings recovery、deterministic guards、merge-base 與 CI coverage 都有一 hop evidence。
- [x] Missing、stale、mixed-attempt、model-authored 或 unsigned evidence 一律不能產生 GO。
- [x] Automated qualification 可重跑並產生 bounded report，明確區分 automated green 與 external evidence blockers。
- [x] Existing clean-machine signed install、N-1→N、entitlement、workflow 與 trust-publication requirements 未被移除或弱化。

## Implementation evidence

- Workflow-owned `release-hardening-receipt.json` binds all six checks to commit, run ID/attempt, version, platform, and arch, then signs that canonical identity with a protected Ed25519 release-hardening key. The aggregate qualifier pins the configured public key/key ID and rejects unsigned, attacker-signed, incoherent receipts and missing owner logs; an unkeyed digest or model-authored authority string is never trusted provenance.
- `npm run smoke:release-qualification`, `npm run smoke:release-hardening-owners`, `npm run check:pi-contract`, and `npm run build` pass.
- The locally rerun Paid Beta report remains bounded and truthfully reports `NO-GO`, `Automated repository hardening: BLOCKED`, and `External release evidence: BLOCKED` while signed-platform evidence is absent.
