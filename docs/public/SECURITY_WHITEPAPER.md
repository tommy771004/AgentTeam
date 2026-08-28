# AgentStudio 安全白皮書（Security Whitepaper）

> 狀態：**Draft 草稿** — 公開前需法務與安全審閱。對應內部基線：`docs/SECURITY_BASELINE.md`。

## 產品定位

AgentStudio 是 **local-first** 的桌面多代理自動化應用（Windows / macOS，Electron）。
你的對話、排程、技能與記憶都存放在**你自己的裝置**；我們不經營集中式的推理後端，
LLM 呼叫直接從你的裝置送往**你自己設定**的模型端點（OpenAI 相容 API、本機 Ollama 等）。

## 執行邊界

- **Renderer 隔離**：`contextIsolation` 啟用、`nodeIntegration` 停用；UI 只能透過
  型別化的 IPC 白名單（`window.subagents.*`）觸發系統操作。
- **生產 CSP**：打包版 UI 掛載嚴格 Content-Security-Policy —— `script-src 'self'`
  （內聯 shim 以 SHA-256 hash 具名放行）、無 `unsafe-eval`、`object-src 'none'`。
- **導覽與外開限制**：應用內只允許載入自身頁面；新視窗一律拒絕；
  外部連結僅 `http/https/mailto` 會轉交系統瀏覽器。
- **網頁權限**：deny-by-default，僅允許剪貼簿寫入、通知與全螢幕。

## 代理安全

- **工具授權**：每個工具呼叫經過 deny 規則、HITL 核准（approvalTools 強制詢問）、
  supervisor 位元組/回合預算三層檢查。
- **CodeMode 沙箱**：模型撰寫的 JS 在 Blob Web Worker 中執行，`fetch`/`XHR`/`WebSocket`
  被停用，只能經由受授權閘管的 `tools.*` RPC 存取外界。
- **無人值守降級**：排程 / webhook / Telegram 觸發的執行自動降低核准模式，
  安全詢問逾時自動拒絕，不會靜默放行。

## 憑證保護

- 連接器 token 僅存於 **main process** 的 OS 安全儲存（Keychain / DPAPI）加密檔。
- Renderer 只能看到遮罩後的 metadata（hint / 到期時間），永遠拿不到原始 token。
- OS 安全儲存不可用時，**預設拒絕**儲存憑證；僅在使用者明確確認後才允許降級，
  且 UI 持續標示「未加密」。OAuth client secret 永不允許明文落地。

## 供應鏈與發佈

- 發佈流程強制：依賴弱點稽核（high/critical 未豁免即擋版）、原始碼祕密掃描、
  CycloneDX SBOM、簽章（Windows Authenticode / macOS notarization）與逐檔 SHA-256 清單。
- 安全例外需記名核准並附到期日（`security-exceptions`），過期自動失效。
- 更新通道：manifest 與安裝檔均以 RSA-SHA256 簽章，用戶端驗章後才安裝。

## 回報弱點

security@subagents.ai（草稿 — 正式信箱待建）。我們承諾 90 天協調揭露時程。
