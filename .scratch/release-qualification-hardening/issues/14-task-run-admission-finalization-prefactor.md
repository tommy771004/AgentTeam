# 14 — Task run admission／finalization prefactor

**What to build:** 在不改變使用者行為的前提下，縮小 Task run coordinator 的 admission 與 unique finalization control flow，讓 capacity、busy policy、snapshot 與 settlement decisions 可獨立驗證。

**Blocked by:** 09 — No-App-launch deterministic qualification；10 — Merge-base complexity qualification。

**Status:** 已完成

- [x] 所有 composer、slash、retry、schedule、webhook、telegram、event、delegate 入口仍只進 `runTask`。
- [x] Admission decision 與 side effects 分離，但 trigger evidence、capacity、thread bind、attachments 與 frozen snapshot 語意不變。
- [x] Unique finalization 順序、idempotency、release/drain 與 failure settlement 由既有 behavior smokes證明未漂移。
- [x] Different-thread concurrency 與 same-thread steer/queue ordering 保持既有 contract。
- [x] Complexity 實質下降，沒有提高 threshold、建立第二 ingress 或把 authority 移入 UI。

## Implementation evidence

- Pure `taskRunAdmission.ts` decisions now own initial rejection, durable external-CLI queue snapshot admission, and frozen busy-policy selection; `taskRunCoordinator.ts` remains the sole side-effect owner.
- The coordinator no longer embeds duplicate/delegate/busy-policy decision trees and no complexity threshold changed.
- `smoke:task-run-ingress`, `smoke-task-run-admission-prefactor`, `smoke-finalize-idempotency`, `smoke-steer-enqueue-fallback`, `smoke-run-lifecycle`, `smoke-run-completion-reachability`, `npm run build`, and the complexity gate pass.
