# 13 — macOS Seatbelt builtin-shell tracer

**What to build:** macOS strict-mode 使用者在 Seatbelt backend 通過 main-side probe 與 canary 後，可以從真實 Pi turn 使用 builtin `bash` 操作 Restricted Project View 內允許的內容；view 外讀寫與不允許的 network 行為被 sandbox 拒絕，所有結果留下可驗證 evidence。

**Blocked by:** 12 — Verified builtin-shell sandbox seam 與新 ADR.

**Status:** 可交給代理

- [x] Seatbelt profile 從 frozen run policy 與 Restricted Project View 建立，不接受模型提供的 profile fragments。
- [x] Main-side probe 和 canary 在每個需要的信任範圍內驗證 backend，失敗時不簽發 evidence。
- [x] 真實 Pi bash turn 能完成至少一個 view 內允許操作並回 success settlement。
- [x] View 外讀取、view 外寫入與 ADR 不允許的 network 嘗試在 OS sandbox 層失敗。
- [x] Tool-call、decision、result 與 Turn Record 攜帶 matching backend、profile digest、view binding 與 contract identity。
- [x] Stale、replayed 或其他 run 的 evidence 無法啟動 shell。
- [x] macOS qualification 同時覆蓋 verified success、probe failure、canary failure、view escape 與 cancellation。


## Comments

- Adapter 是 `app/electron/piSeatbeltShellSandbox.ts`，只在 `piHostEntry.ts` 由 Host 啟動時於 `process.platform === 'darwin'` 註冊；非 macOS 不安裝任何 adapter，因此 verification 回 `unsupported`，ADR-0047 的 `required` 拒絕原封不動。
- Profile 由 view root 單一變數代入固定模板；`SEATBELT_PROFILE_DIGEST` 是模板本身的 sha256（policy 身分），view binding 另外由 evidence 攜帶。模型、renderer、tool args 都沒有進入 profile 的路徑；帶引號的 view root 會被跳脫，注入 `(allow default)` 不會成為規則。
- Verification 通過**不等於**放行：`piToolHost` 在 admission 之後用 Pi 支援的 `event.input` in-place patch 把指令包進 `sandbox-exec`，原指令整串以單一引數傳遞、不解析不改寫。backend 沒有對應 wrapper、或 profile 寫入失敗時**拒絕**而非裸跑 —— verified-but-unwrapped 正是 ADR-0051 要堵的洞。
- Profile 檔 per-run、0600、放在 view 外，`unbindPiSessionRun` 時刪除；沙箱內的指令讀不到也改不了約束自己的 policy（已斷言）。
- macOS 26 實測發現 `(literal "/")` 是必要的 allow：缺它時子行程在執行前被 SIGABRT，會被誤讀成「拒絕」而讓 canary 假通過。已在模板註解記錄。同樣地 `spawnFailed` 與訊號致死必須分開，否則正在生效的沙箱會被回報成不存在。
- `smoke-pi-seatbelt-builtin-shell.mts`（13 tests，已併入 `npm run smoke` 與 `smoke:pi-builtin-shell-sandbox`）在真實 kernel 上證明：view 內讀寫成功、view 外讀寫被 OS 拒絕（stderr 為 `Operation not permitted`）、network 失敗、cancellation 不會 settle success、evidence 綁 run/view/期限、偽造的同形物件不被接受。

### 連帶修正

- `piBuiltinShellSandbox.ts`：canary 檔案無法建立時原本會 reject promise，admission 端看不到；改為回 `canary-failed`。
- `smoke-pi-adr0047-real-turn-denial.mts`：原本的「`required` 一律拒絕」是建立在「尚無平台 adapter」之上。已改為依平台斷言兩種合法結果 —— darwin 走 verified-and-confined（decision reason 必須含 `backend=` / `profile=` / `view=`），其餘平台維持拒絕；forgery 案例改指向無法驗證的 view root，否則在 macOS 上會因為「真的驗證通過」而假通過，反而測不到偽造。

### 已知缺口 → issue 16（已在 smoke 釘住，非本票引入）

- 被**允許**的 model-originated builtin 只寫入 Turn Record，不發 `host/tool-result` 事件（deny 路徑才經過我們的 publisher）。這對所有 builtin 皆然，先前因 `required` 永遠拒絕而沒被發現。已用 `assert.equal(eventResults.length, 0)` 加註解釘住，修好那天這行會失敗並被刻意更新。已開 issue 16 追蹤。
