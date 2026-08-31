# 12 — Critical release hardening qualification

**What to build:** 將安全發布、main-only credentials、settings durability 與 blocking repository guards 接入既有 Paid Beta qualifier rollup；自動 contract 全綠時仍須對缺少的外部 signed-platform evidence 誠實輸出 NO-GO。

**Blocked by:** 03 — Verified channel promotion；07 — Legacy raw-secret contract removal；08 — Atomic settings persistence；10 — Merge-base complexity qualification；11 — Shipped-runtime CI coverage。

**Status:** 可交給代理

- [ ] Qualifier 只消費 owning seams 的可信 receipts，不在 rollup 內重做或偽造下層結果。
- [ ] Release promotion、credential boundary、settings recovery、deterministic guards、merge-base 與 CI coverage 都有一 hop evidence。
- [ ] Missing、stale、mixed-attempt、model-authored 或 unsigned evidence 一律不能產生 GO。
- [ ] Automated qualification 可重跑並產生 bounded report，明確區分 automated green 與 external evidence blockers。
- [ ] Existing clean-machine signed install、N-1→N、entitlement、workflow 與 trust-publication requirements 未被移除或弱化。
