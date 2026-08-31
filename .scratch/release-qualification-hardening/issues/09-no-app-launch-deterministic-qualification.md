# 09 — No-App-launch deterministic qualification

**What to build:** 建立 PR CI 與 release packaging 前共用的 deterministic qualification command，執行 architecture/security/stable guards，但不開啟 Electron、不要求 signing credentials，也不改變純編譯 build 契約。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Command 包含 single Task ingress、Pi ownership、collaboration boundary、security drift 與其他既有 deterministic guards。
- [x] Command 在無 display、無互動、無 signing credentials 的環境可執行，且測試證明不啟動 App。
- [x] PR CI 與 release package job 在 compile/package 前以 blocking step 執行該 command。
- [x] `build` 與 `dist:*` 繼續是 compilation／packaging-only，沒有隱式 smoke/E2E/App launch。
- [x] Guard failure 在 CI 與 release 都可辨識地 fail closed。

## Comments

2026-09-01 — 新增共享 `npm run qualify:deterministic`，集中 build flavor、complexity、release topology、single Task ingress、Pi production ownership／contract、Host-owned collaboration、retired-provider deletion、stable CLI/Pi guards、security drift 與 settings durability；`check` 改為委派該 owner 後再執行原本的 icons、compile 與 built lifecycle，未刪除既有 coverage。`smoke:deterministic-qualification` 在清除 display／signing credentials 的實際 child-process graph 執行整條 command，並以 inherited `NODE_OPTIONS` sentinel 阻止任何 Electron binary spawn；invalid build-flavor fixture 證明 guard failure 有可辨識輸出且 fail closed。PR CI 與 release package job 都在 build 前 blocking 執行，checkout history 只補足現行 complexity `HEAD^` 可執行性；merge-base 語意留給 #10。`build`／`build:compile`／`dist:*` topology guard 維持 compilation／packaging-only。Focused qualification、security、release workflow evidence、build 與完整 `npm run smoke` 全綠；Paid Beta 仍為 NO-GO（0/43）。
