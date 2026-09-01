# Vendored Pi upstream debt inventory

Status: tracked upstream-owned  
Vendor version: Pi 0.84.3  
Reviewed: 2026-09-01

本清單不是 AgentStudio 待修 runtime bug，也不授權修改 `vendor/pi`。`sync-pi.mts` 在每次升級後產生 `upstreamDebt` manifest；`smoke-pi-sync-evidence.mts` 會要求本清單與目前 upstream tree 對帳。

| Item | Current evidence | Owner | Removal trigger |
| --- | --- | --- | --- |
| Bun WebSocket proxy workaround | `packages/ai/src/api/openai-codex-responses.ts` 的 oven-sh/bun#15489 workaround 仍 active | Bun/Pi upstream | Bun WebSocket 正式支援 HTTP proxy env，且 Pi upstream 移除 workaround |
| Xiaomi abort usage | `packages/ai/test/tokens.test.ts` 有 4 個 `FIXME(xiaomi)` skip；abort 前 upstream stream 尚未提供 usage | Xiaomi/Pi upstream | `message_start` 或等價早期事件能提供可驗證 token usage，upstream tests re-enable |
| Xiaomi multimodal fusion | `packages/ai/test/image-tool-result.test.ts` 有 4 個 `FIXME(xiaomi)` skip；text+image tool result 的模型融合品質不足 | Xiaomi/Pi upstream | 同模型的 text+image assertions 在 upstream qualification 穩定通過 |

## Sync rule

- 數量或 workaround 狀態改變時，先讀 upstream diff／release notes，再更新本文件與 smoke expectation。
- upstream 已修復時，接受 vendored sync 自然移除 TODO/skip；不要在 AgentStudio 建立永久 patch。
- upstream 仍未修復時，維持 honest capability/test limitation，不把 skipped provider case 宣稱為 qualified。
