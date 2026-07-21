# 10 — 同步 Workspace 原子 Policy Bundle

**What to build:** 讓明確選擇 `workspace` Policy Source Mode 的安裝，透過經認證 HTTPS 取得一個同時包含 Company Base Policy 與該 provider supplement 的原子 Policy Bundle。只有通過 server 與 Electron main 雙重驗證的 bundle 才成為 last-known-good，離線時依公司 cache policy 決定使用或阻擋。

**Blocked by:** 02 — 建立 Provider Security Profile；04 — 建立本機可驗證 Security Evidence Ledger

**Status:** resolved

- [x] Workspace source 要求 bearer secret reference 或 mTLS authentication，不支援 anonymous 或失敗後改用 local source。
- [x] 每個 response 原子包含 matching base/supplement、workspace/provider identity、bundle version、change ID 與 ETag。
- [x] Electron main 重新驗證 schema、identity、monotonic merge、version 與完整 bundle 後才更新 last-known-good。
- [x] partial、mismatched、replayed 或 malformed bundle 不會取代 last-known-good。
- [x] `offlineCache.maxAgeHours` 與 `onExpired=block|basic|use-stale` 控制離線行為；required Workspace 預設 expired 時 block。
- [x] required Task run admission 釘選一個 bundle；optional active outbound 依契約取得最新有效版本。
- [x] Workspace unavailable 時不會偷偷切到 local source，UI 顯示使用 cache、basic fallback 或 blocked 的實際狀態。
- [x] Workspace sync 事件寫入 Security Evidence Ledger，但不包含政策敏感值或 credential。
- [x] provider 之間使用獨立 bundle identity 與 cache，無跨連線混用。
- [x] fake Workspace scenario 驗證 fresh、304/ETag、offline、expired、mismatched、rollback replay 與 recovery。


## Answer

- `workspacePolicyBundle.ts`: atomic validate, per-connection LKG cache, monotonic version, offline `block|basic|use-stale`, authenticated fetch (no anonymous), identity mismatch refused.
- No auto switch to local source.
- smoke-outbound-phase2.

