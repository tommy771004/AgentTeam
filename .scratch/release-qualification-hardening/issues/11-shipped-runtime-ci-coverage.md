# 11 — Shipped-runtime CI coverage

**What to build:** 讓所有會進入 installer 的 runtime 與其 authority contracts 都能觸發 blocking CI，並在 PR 階段取得最小但誠實的 macOS-specific evidence。

**Blocked by:** 09 — No-App-launch deterministic qualification。

**Status:** 可交給代理

- [ ] 只修改 vendored Pi sources 或 pin metadata 的 PR 會觸發 deterministic qualification、Pi build 與 owning compatibility checks。
- [ ] Release/security/architecture authority contract 的變更會觸發相應 blocking checks，不依賴修改 product source 才啟動。
- [ ] macOS blocking job 執行最小 platform runtime contracts，且不需要或冒充 production signing/notarization。
- [ ] Linux、Windows、macOS jobs 的責任與 platform-only evidence 清楚分離，無重複執行 customer-facing publish。
- [ ] Workflow trigger fixtures 證明 shipped runtime、pin、contract 與普通 app changes 都得到預期 coverage。
