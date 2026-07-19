# SECURITY_BASELINE — Electron runtime boundaries（Issue 06）

本文件記錄 SubAgents AI 桌面版的 renderer 隔離與執行邊界決策。變更任一項須同步更新
`app/electron/securityPolicy.ts` 與 `app/scripts/smoke-security.mts`（drift guard 會擋 build）。

## Renderer isolation

| 設定 | 值 | 理由 |
| --- | --- | --- |
| `contextIsolation` | `true`（所有視窗） | renderer 只能透過 `contextBridge` 暴露的 `window.subagents.*` 呼叫 main；smoke 驗證所有 `webPreferences` 區塊 |
| `nodeIntegration` | `false`（所有視窗） | renderer 無 Node 權能；所有 I/O 走 IPC 白名單 |
| `sandbox` | 主視窗 `false`；其餘視窗 `true` | 主視窗 preload 為 CJS 且 `require` Node 模組（見 `vite.config` preload 註解）。`contextIsolation:true + nodeIntegration:false` 下 preload 仍為受信任邊界；風險由 CSP + 導覽 allowlist + IPC 驗證補償。待 preload 移除 Node 依賴後改 `sandbox:true` |

## Production CSP

`vite.config.ts` 的 `inject-renderer-csp` plugin 在 build 時把
`buildRendererCsp()`（`app/electron/securityPolicy.ts`）注入 `dist/index.html` meta：

- `script-src 'self'` + 具名 `sha256-…` hash（file: 協定 module-loader 內聯 shim）；無 `unsafe-inline` / `unsafe-eval`
- `connect-src https: http: ws: wss:`：使用者可設定任意 LLM 端點 / 本機 Ollama / MCP HTTP，無法列舉主機；程式碼注入面由 `script-src 'self'` 擋住
- `worker-src blob:`：CodeMode 在 Blob Web Worker 執行模型 JS（worker 內 `fetch`/`XHR`/`WebSocket` 已被 CodeMode 停用，僅可走 `tools.*` RPC）
- `object-src/base-uri/form-action/frame-src 'none'`
- dev（vite HMR、react-refresh 內聯 preamble）不注入 CSP

## Navigation / external URL / permissions

集中在 `app/electron/securityPolicy.ts`，main.ts 掛載：

- `will-navigate`：只允許 dev server 同源，或打包後 app 自己的 `file:` index.html（任意本機 HTML 不放行）；其餘 `preventDefault`，安全 URL 轉外部瀏覽器
- `setWindowOpenHandler`：一律 `deny`；僅 `http/https/mailto` 轉 `shell.openExternal`
- `shell:openExternal` IPC：同上 scheme 白名單
- `setPermissionRequestHandler` / `setPermissionCheckHandler`：deny-by-default；白名單僅 `clipboard-sanitized-write`、`notifications`、`fullscreen`

## Secrets at rest

`electron/secretsVault.ts`（main-only、safeStorage 加密檔）：

- OS 安全儲存不可用時，寫入預設**拒絕**（`PLAINTEXT_REQUIRED`），不再靜默落地 `PLAIN` 檔
- 明文 fallback 需使用者在 UI 明確確認後、呼叫端帶 `allowPlaintext: true` 才允許；metadata `encrypted:false` 會在 Settings 顯示「未加密」徽章
- OAuth（含 client secret）永遠拒絕明文（維持既有 `setVaultOAuthSecret` throw）
- renderer 永遠拿不到原始 token；`{{secret:key}}` 於 main 端解析

## 驗證

`npm run smoke:security`（含在 `smoke:ci`）：純邏輯測試 + main.ts / vite.config drift guard。

依賴弱點稽核（`npm audit` → `security-gates.mjs --audit-report`）在 **CI release
qualification**（`.github/workflows/release.yml`）執行 — 需要網路；本機 `smoke:security`
只跑祕密掃描與純邏輯。空殼 / 格式錯誤的 audit 報告會 fail closed。
