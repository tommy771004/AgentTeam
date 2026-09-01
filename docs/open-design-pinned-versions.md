# OpenDesign Pinned Dependencies & Provider Boundaries

> 生成日期 2026-08-20 基準，production 禁止 `latest`。

## Pinned packages / binaries

| Provider | Pinned version | Source | License | 更新方式 |
|---|---|---|---|---|
| Storybook MCP | `8.6.0-alpha` (see `storybookProvider.ts:STORYBOOK_PINNED_VERSION`) | `https://github.com/storybookjs/mcp` | MIT | 手動審核後改常數並跑 `smoke-open-design-providers` |
| Chrome DevTools MCP | `0.0.1-pinned` (`chromeDevToolsProvider.ts:CDT_PINNED_VERSION`) | `https://github.com/ChromeDevTools/chrome-devtools-mcp` | Apache-2.0 | 同上，更新需檢視 `docs/research/open-design-harness-integrations.md` |
| Harness | `0.1.0-alpha` (`harnessProvider.ts:HARNESS_PINNED_VERSION`) | `https://github.com/awizemann/harness` | MIT | 僅主線、手動、macOS 權限說明頁 |
| MCP Apps | host bridge `v1` (`mcpAppsProvider.ts:CSP_SANDBOX` + schema v=1) | `https://github.com/modelcontextprotocol/ext-apps` | Apache-2.0 | 更新 bridge schema 需改 `validateBridgeMessage` 並跑 security smoke |
| Streaming envelope | product-owned `version:1` (`streamingEnvelope.ts`) | n/a (in-house) | — | 僅 host 與 renderer 共享，無外部 runtime |

## Trust boundaries

- **Connector tokens** 僅在 `electron/secretsVault.ts` 加密儲存，renderer / provider result / evidence 僅含 `ref`。
- **Sandbox**: `McpAppSurface.tsx` 使用 `sandbox="allow-scripts"` + `CSP_SANDBOX` (`default-src 'none'`)，`onPostMessage` 皆經 `validateBridgeMessage()` v1 schema，先檢查 `expectedOrigin` 再檢查 `surfaceId`/`kind`/`allowlist`，`prohibited navigation` 與 `oversized payload` 直接拒絕並 `console.warn` 安全原因。
- **Allowlist**: 每個 surface 宣告 `allowlist: string[]`，`isToolAllowed()` 在 host 端再檢一次；`network` / `connector` 操作由 host 代理並走 `Pi Core approval`。

## Capability grants

- `DENY_BY_DEFAULT = fs:write, subprocess, bash, network, mcp, connector`（`pluginSnapshot.ts`）。
- Snapshot 含 `contentHash` + `capabilityFingerprint`，指紋改變即 `needsReapproval()==true`。
- Grant 僅可授權 `requestedCapabilities` 子集，revocation 後下次執行回 `fail closed`。

### 使用者流程（`pluginTrust.ts` + `PluginTrustPanel.tsx`）

決策由 `resolvePluginTrust()` 產生，**唯讀**：準備一次執行不會寫入 snapshot。四種狀態各對應一個明確動作：

| 狀態 | 意義 | 使用者動作 |
|---|---|---|
| `adopt-required` | 專案尚未採用此 plugin | `adoptPluginSnapshot()` — 寫入 snapshot，且不授權任何 capability |
| `refresh-required` | 來源 hash 或 capability 指紋變了 | `refreshPluginSnapshot()` — **明確** refresh 才取代既有 snapshot，並撤銷全部既有 grant |
| `grant-required` | 有 deny-by-default capability 未授權 | `requestCapabilityGrants()` — 逐項走既有 HITL ask |
| `trusted` | 已採用且該 scope 已授權 | 可執行；`revokePluginGrants()` 隨時撤銷 |

- **遠端/vendor 更新不會靜默取代 snapshot**：`refresh-required` 只回報，不寫入。
- Capability 請求走既有 `permissionAskStore.requestAsk()`，維持 run/thread scope；attended 請求等待使用者明確選擇，unattended 執行則直接 fail closed。
- 部分授權仍然 blocked：只要還有未授權的 deny-by-default capability，狀態維持 `grant-required`。

## Plugin inputs

Contract v1 的 `od.inputs` 由 `pluginInputs.ts` 統一解析，**兩側都跑一次**：

- Renderer：`prepareSubDesignRun()` 解析不過就不啟動 run，並回傳 `inputsRequired`，由
  `PluginInputForm.tsx` 以 MCP Apps `form` surface 收集（不可用時退回原生表單，草稿存於
  `surfaceDraftStore`，離開再回來不會遺失）。
- Pi Host：`validateExecution()` 依自己解析出的 manifest **重新** resolve 一次。

因此 surface crash、表單被略過、或手工偽造的 request 都無法跳過必填 input；未宣告的欄位
一律丟棄，不會傳到 provider。宣告的 `default` 會自動套用，`select` 值必須落在 `options` 內。

## Fallback 行為

| 條件 | 結果 |
|---|---|
| feature flag `false` | 回原生 `choice/form/confirmation` 備援（`McpAppSurface.tsx:Fallback*`）；呼叫端可用 `fallback` prop 傳入真正的產品 UI，direction choice 即以原生方向格為備援 |
| iframe crash / `status=error` | 同上備援；`status` 投影至對話（loading/ready/submitted/invalid/expired/unavailable/error） |
| unsupported streaming renderer | 預先 `canRender()` 拒絕並顯示靜態備援（`ArtifactPreview.tsx:streamingGate`） |
| Harness 無權限 / 非 darwin | `harnessAvailability()` 回 `permission-denied` / `unsupported-platform`，降級為靜態 critique |
| 未啟用的 external provider | 由 Host adapter 呼叫 `storybookAvailability()` / `cdtAvailability()` / `harnessAvailability()`，參數即專案持久化的 `providerConfig.enabled`，回 `blocked` |
| 無任何 external provider | `fakePipelineProvider` 為**出貨預設**：無外部 I/O，仍產生真實 artifact 與 adapter-issued evidence；provider success ≠ DoD met |

### Feature flag 邊界

`providerFlags.ts` 只涵蓋**沒有專案設定紀錄**的實驗性介面（`mcp-apps`、`streaming`）。
Storybook / Chrome DevTools / Harness **不在其中**：三者只由各自持久化的 `providerConfig.enabled`
把關，並由 Host adapter 的 `*Availability()` 檢查。兩套 gate 並存會互相矛盾，且其中一套
在 smoke 以外形同虛設，因此只保留一套。

兩者**預設關閉**，但可由使用者逐專案開啟：設定持久化為 `ExperimentalSurfaceSettings`
（與其他 provider 同一套 metadata 機制），由 `ExperimentalSurfaceControl` 呈現支援範圍與開關，
專案綁定時以 `hydrateProviderFlags()` 套用到同步的 render-path gate。關閉時備援路徑完整可用：
MCP Apps 退回原生選擇／表單，streaming 改為完成後預覽。

`providerFlags.ts` 是 **renderer-only**：Pi Host 不得 import（有 drift guard）。Host 端一律以
frozen request 上的 `providerConfig.enabled` 把關，因此 renderer 的開關永遠無法擴大 Host 願意
執行的範圍。

## 非 vendoring 項目

- **TypeUI**: 在授權與服務條款明確前不 vendoring、不複製內容（`spec.md Out of Scope`）。
- **Playwright MCP**: 未建立長駐 browser loop，僅復用既有 Chrome DevTools / browser QA 適配器。
- **OpenGenerativeUI**: 僅借用 streaming envelope 設計，未引入 LangGraph / CopilotKit / 第二 agent runtime。
