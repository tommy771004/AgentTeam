# 13 — Builtin、External CLI 與 plain-browser capability honesty

**What to build:** 讓每個 runner 與執行環境只宣告自己真正執行的 Memory control guarantees。Builtin Pi 提供 verified Working State、Skill preflight 與 Checkers；External CLI 和 plain-browser compatibility path 不得借用相同呈現暗示等價能力。

**Blocked by:** 05 — Working State 的 live、replay 與 reload UI Projection; 09 — Skill preflight retry 與 parallel batch barrier

**Status:** resolved

- [x] Builtin runner capability snapshot 明確宣告 Working State、Skill preflight 與 Checker guarantees，且與實際 Host trace 一致。
- [x] External CLI 保持 `executionKind: external`，不宣告 builtin Parse、DoD、iteration 或 Memory control capabilities。
- [x] CLI process success 不能產生 Checker-backed done state；其 timeline 明確標示 reduced guarantee。
- [x] Plain-browser path 在 Host capability 缺席時 feature-detect 並呈現 unavailable/degraded，不建立 renderer-owned replacement。
- [x] Archive、replay 與 live presentation 都使用 run-time frozen capability snapshot，而非目前 Settings 推測歷史能力。
- [x] Drift guard 阻止 compatibility loop、UI 或 external runner 假冒 Host Working State authority。
- [x] Runner matrix 與 browser-degrade smokes 已加入實際 smoke gate。
