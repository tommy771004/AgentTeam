# 09 — No-App-launch deterministic qualification

**What to build:** 建立 PR CI 與 release packaging 前共用的 deterministic qualification command，執行 architecture/security/stable guards，但不開啟 Electron、不要求 signing credentials，也不改變純編譯 build 契約。

**Blocked by:** None — can start immediately.

**Status:** 可交給代理

- [ ] Command 包含 single Task ingress、Pi ownership、collaboration boundary、security drift 與其他既有 deterministic guards。
- [ ] Command 在無 display、無互動、無 signing credentials 的環境可執行，且測試證明不啟動 App。
- [ ] PR CI 與 release package job 在 compile/package 前以 blocking step 執行該 command。
- [ ] `build` 與 `dist:*` 繼續是 compilation／packaging-only，沒有隱式 smoke/E2E/App launch。
- [ ] Guard failure 在 CI 與 release 都可辨識地 fail closed。
