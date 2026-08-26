# 03 — Catalog 模組衛生：sanitize、provider 清單、clump、版本常數

Status: resolved
Effort: subscription-surface-hardening

## 問題（四份僅靠註解或複製維持同步的重複）

1. Model-row sanitize 在 Host runtime view 重寫了一份 catalog 投影已有的 guard chain → 抽 `sanitizeModelRow` 純函式由 subscriptionCatalog 匯出，兩處呼叫。
2. apiProviders 的 preset 表以註解 "Mirrors" 鏡射 subscriptionCatalog 的訂閱 provider 清單 → 改 import，刪第二份定義。
3. `{oauthImportedProviders, oauthSkippedProviders, oauthConflicts}` 在 piHostEntry 相鄰兩處手寫展開，`PiOAuthSyncStatusShape` 型別已存在 → 打包傳遞。
4. protocol 字面值 `4` 硬編在 supervisor 協商、protocol smoke、qualify e2e 三處 → 由 protocol 模組匯出常數，三處 import。

## 驗收條件

- [x] 四項重複各只剩一個 owner；rg 檢查無殘留字面值 `4` 於協商／斷言路徑（常數 import 除外）。
- [x] 行為不變：smoke-subscription-catalog／smoke-pi-host-protocol 全綠（sanitize 去重屬重構，投影輸出必須逐位元組一致）。
- [x] 新增 provider 時只需改一處清單（以 source-text drift guard 斷言 preset 表來自 import）。
