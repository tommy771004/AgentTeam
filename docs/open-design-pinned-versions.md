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

## Fallback 行為

| 條件 | 結果 |
|---|---|
| feature flag `false` | 回原生 `choice/form/confirmation` 備援（`McpAppSurface.tsx:Fallback*`） |
| iframe crash / `status=error` | 同上備援；`status` 投影至對話（loading/ready/submitted/invalid/expired/unavailable/error） |
| unsupported streaming renderer | 預先 `canRender()` 拒絕並顯示靜態備援（`ArtifactPreview.tsx:streamingGate`） |
| Harness 無權限 / 非 darwin | `harnessAvailability()` 回 `permission-denied` / `unsupported-platform`，降級為靜態 critique |

## 非 vendoring 項目

- **TypeUI**: 在授權與服務條款明確前不 vendoring、不複製內容（`spec.md Out of Scope`）。
- **Playwright MCP**: 未建立長駐 browser loop，僅復用既有 Chrome DevTools / browser QA 適配器。
- **OpenGenerativeUI**: 僅借用 streaming envelope 設計，未引入 LangGraph / CopilotKit / 第二 agent runtime。
