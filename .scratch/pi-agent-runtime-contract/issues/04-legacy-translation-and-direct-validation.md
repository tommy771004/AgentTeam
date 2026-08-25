# 04 — Legacy translation fixture 與 direct protocol validation

**What to build:** 舊 renderer 工具與 Pi builtin 的差異以 qualification-only translation fixture 被精確保存，direct Host calls 則依當前 Turn Tool Contract 驗證完整參數。Rename、default materialization 與 semantic translation 不再被誤稱為相同 schema，renderer definitions 也不再是 production authority。

**Blocked by:** 01 — Turn Tool Contract 首條垂直切片.

**Status:** 可交給代理

- [x] Legacy fixture 對每個已移除工具記錄 Host tool name、parameter rename、default materialization 與 semantic translation。
- [x] `workspace_grep` 明確記錄 `query` 到 `pattern`，預設 project-relative path 另記為 materialization。
- [x] 相同名稱的 parameter 不得被描述為 rename。
- [x] Direct protocol 使用該 session 的 contract schema 驗證 properties、types、required、defaults、enums、bounds 與 nested shapes。
- [x] Protocol envelope fields 與 model tool arguments 被清楚分開，只有前者可保留專用檢查。
- [x] Parity smoke 驗證 translation 後的成功、structured failure、defaults 與 semantic results，不再只驗證 requiredness。
- [x] 移除 renderer live definitions 對 production validation 或 catalog 的 authority，並以 drift guard 防止它重新出現。

## Comments

Implemented and independently verified. Direct builtin and Extension Pack calls validate model arguments against the current session contract while keeping protocol routing fields separate; JSON Schema defaults and nested constraints are applied by the Host validator; stale revision and digest claims fail closed. The six removed renderer equivalents now live only in a qualification translation fixture, with explicit rename/default/semantic evidence and production-import drift guards. `npm run smoke:pi-host-direct-contract` and `npm run build` pass.
