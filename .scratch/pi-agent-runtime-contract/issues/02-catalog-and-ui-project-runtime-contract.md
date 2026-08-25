# 02 — Catalog 與 UI Projection 改讀 runtime contract

**What to build:** 使用者在 Settings 看到的工具目錄由 Host 的 Turn Tool Contract 投影，顯示實際 source、Extension Pack、active state、availability reason 與 schema digest。Host 無法產生可信 catalog 時，桌面版明確告知不可用，plain-browser compatibility 則明確降級，不會偷偷使用 renderer 的第二份目錄。

**Blocked by:** 01 — Turn Tool Contract 首條垂直切片.

**Status:** 可交給代理

- [x] `tools/list` 從 Host-owned contract facts 產生 compact catalog，不 eager 回傳所有完整 schema。
- [x] 每個 entry 攜帶自己的 source、pack、active、available、reason 與 schema digest。
- [x] Settings UI Projection 顯示 Host catalog 的可用狀態與原因，不把 renderer cache 回寫成 authority。
- [x] Host catalog 失敗或 protocol 不相容時，Electron UI 呈現明確錯誤且不得回退 renderer definitions。
- [x] Plain browser feature-detects Host methods，保留既有 compatibility 行為並清楚標示沒有 Electron Pi contract。
- [x] Catalog 排序與相同 snapshot 的結果穩定，不因 discovery response 順序漂移。
- [x] Protocol 與 UI smoke 同時證明可用、停用、不可用與 fail-closed 四種情況。

## Comments

Implemented and verified. Catalog entries now project Host-owned source, pack, activation, availability, reason, and schema digest facts through the negotiated contract path. Electron Settings projects those facts, catalog failure is explicit, and plain-browser mode is identified without renderer-catalog fallback. The dedicated catalog smoke and `npm run build` pass.
