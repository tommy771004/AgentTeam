# 06 — 以檔案系統沙箱執行 Required CLI

**What to build:** 讓 `required` external CLI run 只在已驗證的 filesystem sandbox 中啟動。CLI 可讀取 Sanitized Workspace 與必要 runtime，但不能透過絕對路徑、home、原始專案、符號連結或其他本機路徑繞過 Restricted Project View。

**Blocked by:** 04 — 建立本機可驗證 Security Evidence Ledger；05 — 建立 Sanitized Workspace 與安全回寫

**Status:** resolved

- [x] CLI prompt 與 attachment references 只指向 Sanitized Workspace 內的可見 artifact，不包含原始 project absolute path。
- [x] sandbox deny 原始 project、使用者 home、外部 symlink target 與無關 filesystem path。
- [x] required mode 只在 sandbox capability 被實際驗證後建立 CLI process。
- [x] required mode 缺少 sandbox 時只停用 external CLI，提供不含敏感資料的原因，sanitized direct LLM 仍可使用。
- [x] optional/demo 可依 policy 在 sanitized current directory 執行，但 UI 與 evidence 必須標示 filesystem isolation unverified。
- [x] CLI 產生的變更仍經由 safe writeback，不得直接修改原始 Protected Exclusion。
- [x] process cancel、timeout、failure 與 success 都會清理 sandbox 並留下對應的 outbound/evidence outcome。
- [x] 外部 CLI 的 parse/DoD/capability 宣告維持既有語義，不因 sandbox 被誤標為 builtin DoD success。
- [x] scenario CLI 嘗試讀取相對安全檔、原始 absolute path、home 與外部 symlink，只有安全檔成功。
- [x] Electron contract smoke 驗證 sandbox adapter 與 IPC 能力存在，但不複製 scenario 的產品行為測試。


## Answer

- `cliSandbox.ts`: `evaluateCliSandboxGate` (required→verified only; optional/demo→unverified mark; off bypass); `rewriteCliPromptForView`; capability probe.
- `localCliRun` gates before process; rewrites prompt/cwd to bound Sanitized Workspace; non-sensitive deny reasons.
- Full OS sandbox adapter (seatbelt/bubblewrap) remains platform follow-up — status `unverified` until `project.sandboxVerify` exists.
- smoke-cli-sandbox in smoke/smoke:ci.

