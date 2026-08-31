# 10 — Merge-base complexity qualification

**What to build:** 讓 complexity regression gate 以 PR merge-base 衡量整個變更集，並修復當前 regression，使 multi-commit PR 不能只靠最後一個 commit 避開檢查。

**Blocked by:** 09 — No-App-launch deterministic qualification。

**Status:** 可交給代理

- [ ] CI 明確解析 PR base SHA 並計算 merge-base；PR path 不得回落到 `HEAD^`。
- [ ] Local invocation 有清楚且可覆寫的 baseline policy，不把 CI-only assumptions 藏進工具。
- [ ] Multi-commit fixture 的 regression 位於較早 commit，merge-base gate 必須抓到，former `HEAD^` behavior 被反例鎖定。
- [ ] 當前 checkout 所有 complexity regressions 透過 behavior-preserving extraction 修復，不提高 threshold 或加入豁免。
- [ ] Complexity gate 納入 deterministic qualification 並保持無 App launch。
