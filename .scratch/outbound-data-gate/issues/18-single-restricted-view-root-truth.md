# 18 — Restricted Project View Root 單一真相源

**What to build:** 保護啟用時，所有需讀專案的工具與路徑解析都指向 **同一** Restricted Project View root（main 為 run 綁定的視圖），而不是依賴僅在 Node smoke 才呼叫的 renderer 記憶體 registry、或在缺 pin 時跌回 UI project store 的原始專案。生產路徑與 scenario smoke 的「view 贏過 original」語義必須一致。

**Blocked by:** 17 — required 下 View 準備失敗必須 Fail-closed

**Status:** resolved

- [x] 保護中的 run 具備明確的 view root 查詢（main `viewRoot(runId)` → local pin → explicit → UI）。
- [x] prepare 成功後 coordinator `pinRestrictedViewRootForRun`；工具 root = view 且贏過 original。
- [x] concurrent runs 以 runId 隔離 pin map。
- [x] 雙 map 收斂：lightweight root pin + optional full workspace；unbind/unpin 同步。
- [x] smoke：`smoke-outbound-view-root.mts`；run-scenario 回歸綠。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bug 10

## Answer

- pure: `resolveProtectedProjectRoot` in `runContext.ts`
- pin API: `pinRestrictedViewRootForRun` / `unpin` / `getRestrictedViewRootForRun`（bind 也會 pin）
- `resolveEffectiveProjectRoot`: main IPC viewRoot → local pin → explicit → UI
- coordinator: prepare success pin；finalize unpin + disposeRunView
