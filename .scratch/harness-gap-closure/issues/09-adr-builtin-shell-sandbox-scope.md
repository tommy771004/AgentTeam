# 09 — Decide whether the sandbox obligation extends to the builtin shell

**What to build:** An ADR deciding whether ADR-0022's filesystem-sandbox obligation covers the builtin shell, and — only if accepted — the implementation that feeds real probe results into the decision.

**Blocked by:** None.

**Status:** resolved

ADR-0047 與 ADR-0051 已接受並完成此 scope decision。Builtin shell 不借用 ADR-0022 external CLI 的 capability boolean，而由 Host-owned verifier 與同一 platform adapter 負責 probe、雙 canary、evidence、command wrapping 與 cleanup。

`required` 在 macOS 使用 Seatbelt、Linux 使用 bubblewrap；只有逐 run 驗證成功且 command 實際被同一 adapter 包裝時才允許。Windows 與無 backend／probe 失敗／canary 失敗環境維持 fail-closed，不降級 optional。舊分析提到的 renderer `shellIsolationVerified` boolean 與 `src/agent/tools/registered/bash.ts` call site 已不存在於 production owner。

- [x] ADR-0047／0051 說明 builtin shell 與 ADR-0022 的關係及獨立 sandbox obligation。
- [x] `required` 定義為 Host 驗證且實際隔離後執行，否則拒絕。
- [x] Windows fallback 明定為 unsupported 並拒絕，不靜默降級。
- [x] ADR 連結 `docs/DEEPSEEK_HARNESS_COMPARISON_2026-08-17.md` 作為分析記錄。
- [x] Host verifier 由真實 backend probe 與 inside/outside canary 簽發 run/view-bound evidence。
- [x] macOS Seatbelt 與 Linux bubblewrap adapters 由 Host startup 註冊並包裝實際 command。
- [x] `smoke-pi-builtin-shell-sandbox-seam`、platform smokes 與 real-turn qualification 覆蓋 verified execution 與 fail-closed refusal。
- [x] `smoke-outbound-shell-evidence` 明確只驗證缺 Host evidence 的 policy helper 仍拒絕，避免誤稱 production 永遠拒絕。

Files: `docs/adr/`, `app/src/agent/tools/registered/bash.ts`, `app/src/agent/outbound/cliSandbox.ts`, `app/electron/cliFilesystemSandbox.ts`, `app/electron/shellBridge.ts`.
