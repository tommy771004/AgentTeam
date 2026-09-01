# Effort 進度狀態（上下文壓縮用）

更新：2026-09-01（session 5，OAuth rotation follow-up 收口）

## 結論：7/7 resolved，qualification GO

證據總表見 [qualification.md](qualification.md)。要點：

1. build（tsc -b + vite）exit 0、oxlint src 乾淨、淨環境完整 smoke chain「OK - qualification chain passed」（99 支）。
2. Protocol v4 握手 + v2/v3 client 相容視窗 {4,3,2}。
3. Fail-closed 矩陣：fixture 全綠 + 實機活體 `openai-codex=available(7) anthropic=unavailable(0)`。
4. 真實訂閱 E2E PASS：隔離 dir 匯入真 codex OAuth → settings/update openai-codex+gpt-5.4-mini → settlement=answered（真 Codex 訂閱後端）→ Turn Record 完整。無 vendor binary。
5. 安全抽查：auth.json 實測 0600／dir 0700；snapshot 全文 7 種 credential 形狀零命中（探針只輸出判定）。
6. CLAUDE.md Settings 段補一行；INDEX.md 本 effort 標 resolved。
7. OAuth rotation follow-up：Host 預設跟隨同一 CLI authority 的 token／account 變更，opt-out 維持 conflict；真機隔離 E2E 證明同一 Host 無重啟恢復。

## 各票落點

| # | 票 | 主檔案 |
|---|---|---|
| 01 | catalog 純投影 | `app/src/agent/subscriptionCatalog.ts` + `smoke-subscription-catalog.mts` |
| 02 | Host snapshot + v4 | `electron/piCoreRuntime.ts`（buildPiSubscriptionModelView）、`piHostEntry.ts`（assemble 接線）、`piHostProtocol.ts`/`piHostSupervisor.ts` |
| 03 | renderer preset 面 | `src/agent/types.ts`、`apiProviders.ts`、`SubscriptionConnectionStatus.tsx`、`piProduction.ts`（patch 剝離單點） |
| 04 | 模型 picker fail-closed | `src/components/settings/SubscriptionModelPicker.tsx`、SettingsPage 分支、settingsStore testConnection |
| 05 | drift guards ×3 | `scripts/smoke-subscription-labeling.mts`（已掛鏈） |
| 06 | qualification | `qualification.md` + `qualify-subscription-snapshot.mts` + `qualify-subscription-e2e.mts`（真機專用，不進鏈） |
| 07 | CLI OAuth rotation／account following | `piUserConfig.ts`、`piHostEntry.ts`、`piHostProtocol.ts`、`qualify-subscription-oauth-rotation-e2e.mts` |

## 給未來 session 的關鍵事實

- ⚠️ 跑全鏈前 `env -u SUBAGENTS_PI_SYNC_CLI_OAUTH`——本機 shell 有此 export 且有真 `~/.codex/auth.json`，否則 smoke 隔離 dir 被匯入真憑證、`smoke-pi-turn` 反轉。（這同時是 E2E 活體證明來源。）
- Protocol v4；initialize 拒 v1；v2 相容是契約（70 fixture + qualify-pi-host pin protocolVersion===2 刻意不動）。
- 投影 verdict 順序：conflict → 無憑證 → providerModelError 原文 → 零模型 → available；skip ≡ 有憑證。
- Guard 對「自己的註解」也會誤擊（`auth.json`、`alias`、`llm.models` 字樣）；改註解不放宽 guard。
- 目錄首模型未必有 entitlement（spark 被帳號拒絕→有解釋的 failed settlement＝契約正常）；連續爆發式掃描會限流，`qualify-subscription-e2e.mts <modelId>` 支援單模型探測。

## 邊界（維持）

- 不動外部 CLI runner、connector vault、capability matrix。
- token 不過 IPC；renderer 只消費 availability metadata。

## 後續歸宿（subscription-surface-hardening effort）

- spec L26／story 9 的「離線時退回最後快取的 catalog 並如實標示」原屬本 effort 承諾但無票認領；已由 `.scratch/subscription-surface-hardening/issues/02-offline-catalog-fallback.md` 實作收口（`resolveCatalogPublication` 純決策＋`subscriptionCatalogStale/CachedAt` 標示＋兩個 settings 面的過期徽章）。ticket 01/02 的此項缺口以該票為準。
- ticket 03/04 的「序列化 drift guard 覆蓋範圍」缺口同由該 effort 的 smoke-subscription-catalog 強化（supervisor 常數化、publication 決策、settings 元件 hook 契約）。
