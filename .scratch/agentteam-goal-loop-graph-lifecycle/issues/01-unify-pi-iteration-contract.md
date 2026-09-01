# 01 — 統一 Pi iteration contract

**What to build:** 讓 Goal-based builtin Pi runs 使用唯一 shared iteration bound，使請求的 1、8、16、32 輪與 Host 實際執行、journal 及 UI projection 一致。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Host orchestration 對 1、8、16、32 使用 shared clamp 並實際執行相同上限。
- [x] Architecture qualification 禁止 builtin orchestration 定義私有 literal cap。
- [x] 既有 orchestration、continuation 與 Host run qualification 維持通過。

## Qualification

- Focused orchestration、Host run config、continuation、resilience 與 drift-guard smokes 通過。
- TypeScript／Vite／Electron production build 與 oxlint 通過。
- Repository-wide complexity 與 Pi contract gates 目前分別被既有 PermissionAsk／Protocols complexity changes，以及未接入 gate 的 `smoke-permission-ask-panel.mjs` 阻擋；兩者不屬於本 ticket 的修改範圍。
