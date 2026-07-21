# 21 — 保護下 Builtin Shell 不得逃出 Restricted Project View

**What to build:** 當保護啟用（尤其 `required`）時，builtin shell / bash 類工具不能只靠 cwd 指到 view，而仍可用絕對路徑讀取原始專案、home 或其他逃逸路徑。必須 **拒絕** 未隔離 shell，或套用與 required CLI 同等級的 filesystem isolation，使「僅存在於 original root 的 sentinel」在保護 run 中不可讀。

**Blocked by:** 18 — View root 單一真相源；20 — Main 強制 CLI Filesystem Sandbox

**Status:** resolved

- [x] 保護啟用時 absolute path 逃出 view → deny。
- [x] required + 無 shellIsolationVerified → deny host shell。
- [x] optional/demo → allow + degraded 標記。
- [x] bash handler 接 `decideBuiltinShellUnderProtection`。
- [x] smoke：`smoke-outbound-shell-evidence.mts`。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bug 5

## Answer

- pure: `decideBuiltinShellUnderProtection` in `cliSandbox.ts`
- `registered/bash.ts` 在執行前 gate
