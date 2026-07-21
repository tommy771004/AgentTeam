# 20 — Main 強制 CLI Filesystem Sandbox（含 canary 不污染原專案）

**What to build:** external CLI 在 `required` 下只有經 **main** 驗證、綁定該 run Restricted Project View 的 filesystem sandbox 才可建立 process；renderer 省略 wrap 或偽造 isolation 狀態不得成功 spawn。Sandbox probe 的 forbidden canary 不得寫入原始專案樹。`verified` 至少保證原專案路徑不可讀；並記錄 adapter 最小允許面，避免「只過 cat canary」卻讓營運以為隔離成立。

**Blocked by:** 16 — Main 擁有 effective Guard Mode；18 — Restricted Project View Root 單一真相源

**Status:** resolved

- [x] main `cli:runAgent` 於 spawn 前呼叫 `decideMainCliSpawnAdmission`；required 無 wrap / cwd 外 / mismatch / unverified → deny。
- [x] 不信任 renderer 僅 isolationStatus；required 時 main 重跑 `verifyCliFilesystemSandbox`。
- [x] `allocateForbiddenCanaryPath` 在 tmp，不在 original/view。
- [x] optional/demo 無 wrap 可 allow + unverified mark（既有 evaluateCliSandboxGate）。
- [x] smoke：`smoke-cli-main-sandbox.mts`。
- [x] seatbelt/bwrap 仍以 view 可讀、forbidden 不可讀為 verified（殘餘開口見 cliFilesystemSandbox 註解）。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bugs 4, 6, 7

## Answer

- pure: `decideMainCliSpawnAdmission` / `allocateForbiddenCanaryPath` / `isPathInsideRoot` in `cliSandbox.ts`
- main: `cli:runAgent` re-probe + admission before attachments/spawn
- localCliRun: canary via allocate；pass `effectiveMode` to main
- smoke-cli-main-sandbox 11 tests
