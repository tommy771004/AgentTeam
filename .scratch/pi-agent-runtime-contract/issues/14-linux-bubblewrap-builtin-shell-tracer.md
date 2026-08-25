# 14 — Linux bubblewrap builtin-shell tracer

**What to build:** Linux strict-mode 使用者在 bubblewrap backend 通過 main-side probe 與 canary 後，可以從真實 Pi turn 使用 builtin `bash` 操作 Restricted Project View 內允許的內容；view 外資源與不允許的 network 被 mount namespace 和 policy 拒絕，且 unsupported 環境維持 fail closed。

**Blocked by:** 12 — Verified builtin-shell sandbox seam 與新 ADR.

**Status:** 可交給代理

- [x] bubblewrap profile 從 frozen run policy 與 Restricted Project View 建立，不接受模型提供的 namespace 或 mount arguments。
- [x] Main-side probe 驗證 binary、kernel capabilities 與 canary behavior，僅 binary 存在不能通過。
- [ ] 真實 Pi bash turn 能完成至少一個 view 內允許操作並回 success settlement。
- [ ] View 外讀取、view 外寫入與 ADR 不允許的 network 嘗試在 sandbox 層失敗。
- [x] Tool-call、decision、result 與 Turn Record 攜帶 matching backend、profile digest、view binding 與 contract identity。
- [x] 缺少 bubblewrap、kernel 不支援、probe/canary failure 或 evidence mismatch 時保持 `required` denial。
- [ ] Linux qualification 同時覆蓋 verified success、unsupported、probe failure、view escape、replay refusal 與 cancellation。


## Comments

- Adapter 是 `app/electron/piBubblewrapShellSandbox.ts`，在 `piHostEntry.ts` 由 Host 啟動時依平台註冊（darwin→seatbelt、linux→bwrap、其餘不安裝）。
- Argv 由 view root 這唯一變數代入固定模板；`BWRAP_PROFILE_DIGEST` 是模板本身的 sha256。view root 以**獨立 argv 元素**代入、不做字串串接，所以 `"/tmp/evil --bind /etc /etc"` 這種值只會變成一個（不存在的）路徑，不會生出第二個 bind（已斷言）。
- `--unshare-net` 是 ADR-0051 要求的 network 拒絕；ADR-0022 的 `buildBwrapArgs` 沒有它，所以兩份 argv 刻意分開，避免為 external CLI 做的調整靜默改動 builtin shell 的邊界。
- 刻意**不**要求 `--unshare-user`：在停用 unprivileged userns 的主機上它會直接失敗，一個在普通機器上起不來的沙箱只會被關掉而不是被修好。已寫在模板註解。
- Probe 不接受「binary 存在」：它實際要求 kernel 授予 namespace，失敗時回 `unsupported` 並說明可能是 unprivileged user namespaces 被停用。

### 連帶重構（讓 14 不必再動 piToolHost）

- `TrustedBuiltinShellSandboxAdapter` 新增選用的 `prepareExecution` / `releaseExecution`：**驗證沙箱的那個 adapter 同時擁有 wrapper**。獨立的 wrapper registry 可能與 verifier 漂移，用一份沒人驗證過的 policy 去 confine 指令。
- 新增 `wrapVerifiedBuiltinShellCommand()` / `releaseBuiltinShellExecution()`；`piToolHost` 改為呼叫 seam，不再 import 任何平台模組。backend 不符、沒有 wrapper、wrapper 拋錯，一律**拒絕**而非裸跑。
- issue 13 的 seatbelt adapter 已改用同一條路徑，13 的 13 支測試全數維持通過。

### 三條的驗證place已就位（2026-08-25）

`.github/workflows/ci.yml` 的 `verify` job 本來就跑 `ubuntu-latest`，缺的只是安裝 bubblewrap 與執行這支 smoke。已補上兩個 Linux-only 步驟：`apt-get install -y bubblewrap`，然後 `build:pi-host` + `smoke-pi-bwrap-builtin-shell.mts`。

因此下列三條的驗證由 **CI 的 Linux job** 負責，而不是「待部署時再說」—— 平台差異應該在 CI 擋下，不是在使用者機器上被發現。本機（macOS）仍無法執行，所以在 CI 首次綠燈之前**維持未打勾**：

- 真實 Pi bash turn 完成 view 內操作並回 success settlement
- View 外讀取／寫入與 network 在 sandbox 層失敗
- Linux qualification 覆蓋 verified success、unsupported、probe failure、view escape、replay refusal、cancellation

`scripts/smoke-pi-bwrap-builtin-shell.mts` 已把這些寫成 kernel-settled 測試：在 Linux 上會真的執行並斷言，在其他平台逐條印出 `– …(needs a Linux kernel; not run on darwin)`，結尾明講「bubblewrap confinement is unproven on this host」。目前在 macOS 上 11 項平台無關的斷言通過（argv 構成、注入防護、指令原樣傳遞、digest、非 Linux unsupported、digest 不符、binary-only 不通過、無 wrapper 被拒、跨 backend 不可借用、seam 走 verifying adapter）。**要合併前請在 Linux 上跑一次這支 smoke。**
