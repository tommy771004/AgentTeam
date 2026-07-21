# 02 — 建立 Provider Security Profile

**What to build:** 讓公司以兩層 JSON 政策管理每個 immutable provider connection。Company Base Policy 建立所有連線的最低保障，Provider Supplemental Policy 只為單一連線增加或收緊規則，並可從 Electron main 管理的 local policy source 形成可供 Outbound Data Gate 使用的 Provider Security Profile。

**Blocked by:** 01 — 建立統一出站閘門與 Guard Mode

**Status:** resolved

- [x] 每個已設定的 provider connection 都取得穩定且不可變的 connection ID；同品牌的兩個連線仍是不同 identity。
- [x] Company Base Policy 與每個 connection 的 Provider Supplemental Policy 使用版本化 JSON schema，且不存放在專案或 renderer localStorage。
- [x] supplemental merge 只能增加或收緊 base 規則；任何刪除或放寬嘗試都驗證失敗。
- [x] 不同 provider connection 的 policy、cache、exclusion state 與 effective profile 不會互相混用。
- [x] 缺少 Company Base Policy 時會原子建立內建 baseline；缺少 supplement 時會為偵測到的 connection 建立空白 additive policy。
- [x] 已存在但格式錯誤的政策檔保持原樣，受影響 connection 的受保護出站被阻擋，其他 provider 與非 AI 功能保持可用。
- [x] `SUBAGENTS_OUTBOUND_POLICY_DIR` 可指定 Electron main 管理的公司政策目錄。
- [x] `SUBAGENTS_POLICY_SOURCE=local|workspace` 被建模成獨立權限來源，且不存在隱式 auto 切換。
- [x] Settings 可顯示不含敏感值的 provider ID、政策來源、有效版本與錯誤狀態。
- [x] production-module 與 scenario fixtures 證明 base floor 不可被 supplement 削弱，且兩個相同品牌連線維持隔離。


## Answer

- `providerConnectionId.ts`：builtin LLM 與 CLI 的 immutable connection ID（同品牌不同 baseUrl 分離）。
- `policySchema.ts`：Company Base + Provider Supplemental 版本化 schema；builtin baseline；supplement 禁 `disabledBaselineDetectorIds`。
- `policyMerge.ts`：monotonic merge（只增強/收緊）；`compileProviderSecurityProfile`。
- `policyStore.ts`：local 政策目錄 bootstrap / load；malformed 保留檔案並回傳 block reason；`SUBAGENTS_OUTBOUND_POLICY_DIR`。
- `policySourceMode.ts`：`local|workspace` only（無 auto）。
- Settings 顯示非敏感 provider ID 與 policy source。
- smoke-provider-security-profile（8）掛入 smoke / smoke:ci。

