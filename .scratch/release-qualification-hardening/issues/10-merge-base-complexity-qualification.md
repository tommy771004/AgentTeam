# 10 — Merge-base complexity qualification

**What to build:** 讓 complexity regression gate 以 PR merge-base 衡量整個變更集，並修復當前 regression，使 multi-commit PR 不能只靠最後一個 commit 避開檢查。

**Blocked by:** 09 — No-App-launch deterministic qualification。

**Status:** resolved

- [x] CI 明確解析 PR base SHA 並計算 merge-base；PR path 不得回落到 `HEAD^`。
- [x] Local invocation 有清楚且可覆寫的 baseline policy，不把 CI-only assumptions 藏進工具。
- [x] Multi-commit fixture 的 regression 位於較早 commit，merge-base gate 必須抓到，former `HEAD^` behavior 被反例鎖定。
- [x] 當前 checkout 所有 complexity regressions 透過 behavior-preserving extraction 修復，不提高 threshold 或加入豁免。
- [x] Complexity gate 納入 deterministic qualification 並保持無 App launch。

## Comments

2026-09-01 — `check-complexity-regression.mts` 現在公開且記錄 baseline policy：CLI argument 與 `COMPLEXITY_BASE_REF` 可覆寫 local 預設 `HEAD^`；GitHub PR path 具有最高優先權，必須取得 workflow 注入的 `COMPLEXITY_PR_BASE_SHA`，由工具計算 `git merge-base HEAD <base-sha>`，缺值或 local `HEAD^` override 都不能繞過。分岔 base／feature 歷史的臨時 repo fixture 在較早 feature commit 引入 complexity regression、tip 只加無關檔案，並傳入已前進的 base branch SHA，證明 merge-base 能解析共同祖先且抓到 regression，而舊 `HEAD^` 行為會漏檢。實際 checkout 相對 PR 對應的 `origin/main` merge-base 無 regression，因此沒有提高 threshold、豁免或跨票重構；spec 建立點包含後續多票已交付差異，不冒充本票 PR baseline。fixture 直接納入 headless `qualify:deterministic`，所以 PR CI、release package 與 `smoke:release` 都有 blocking reachability。Focused merge-base／PR fail-closed／release evidence／headless qualification、oxlint、production build與完整 `npm run smoke` 全綠；Paid Beta 仍為 NO-GO（0/43）。
