# 06 — Policy and Evidence module 擴展切片

**What to build:** 一個代表性的 Extension Pack tool 從真實 Pi turn 走過新的 Host-owned policy and evidence module，讓 activation、Approval Decision、Outbound Data Gate、Restricted Project View、audit 與 settlement 集中在一個深 module；舊路徑暫時共存，使這次 expand 可以獨立保持 build 與 smoke 綠燈。

**Blocked by:** 01 — Turn Tool Contract 首條垂直切片; 05 — 真實 Pi tool-call qualification 與 contract identity.

**Status:** 可交給代理

- [x] 新 module 接受 invocation coordinates、origin、tool contract identity、args 與 frozen run policy，回傳 allow、ask 或 deny。
- [x] 現有 Approval Decision 順序保持不變：restrictive deny 優先、capability-required approval 不被完整存取權越過、unattended 保留 downgrade 與 timeout。
- [x] Outbound Data Gate 與 Restricted Project View 使用 task-run admission 已凍結的 posture，不從 mutable Settings 重新推導。
- [x] 一個代表性 Extension Pack tool 的 allow、ask、deny、structured failure 與 success 全部走新 module。
- [x] start、decision、bounded update、result 與 settlement 保持現有 coordinates 並進入 Turn Record。
- [x] 新 module 不執行 Pi tool loop，也不接管 builtin implementation。
- [x] Expand 後尚未遷移的 origins 繼續工作，並有清楚 migration inventory 防止半遷移被誤認完成。

## Comments

Implemented and independently verified. The Host-owned policy/evidence module consumes frozen run posture and immutable contract identity, with an explicit migration ledger. Model-originated `workspace_download` is the representative expand slice: activation, restrictive deny, capability approval, unattended downgrade, outbound/view rooting, structured failure, success, bounded evidence, and exactly-once settlement are covered. A follow-up red smoke exposed and fixed execution against the original cwd when the Restricted Project View was a distinct root. `npm run smoke:pi-policy-evidence-expand` and `npm run build` pass.
