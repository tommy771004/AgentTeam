# 02 — Host snapshot catalog 暴露 + protocol v4

Status: resolved
Spec: `.scratch/cli-subscription-pi-loop/spec.md`

## What to build

把 01 的投影接上真實資料源並隨 snapshot 送出：

1. Host entry（utility process 啟動路徑）以與 sessions 相同的 `authPath` / `modelsPath` 建一個 catalog ModelRuntime，對每個訂閱 provider 跑 `getModels`，經 `projectSubscriptionCatalog` 合成 rows。
2. ModelRuntime 建構失敗時：該 provider 以 `unavailable` + 明確 reason 呈現（絕不靜默空清單）。
3. `PI_HOST_PROTOCOL_VERSION` 3 → 4；negotiation 繼續接受前一版本（v3、v2 保持可讀），initialize 回應帶新 negotiated 版本。types/smokes 同步。

**Blocked by:** ticket 01 ✅ + active-run-reattachment v3 收口併入（已於 commit `5e60e00` 收口）✅

## Acceptance criteria

- [x] Host snapshot 的 config 含 subscriptionCatalog（settings/get 與 state/snapshot 都看得到）
- [x] 每個 row 的 models 是 bounded 頁（≤32），modelTotal 揭示截斷
- [x] 序列化後無任何 token 形狀字串（drift guard 斷言）
- [x] PI_HOST_PROTOCOL_VERSION = 4；舊 client（v2/v3）initialize 仍成功
- [x] 相關 smokes 全綠；protocol handshake smoke 斷言 v4
- [x] `npm run build` typecheck 通過

## Comments

**Implemented and verified.**

落地：

- `electron/piCoreRuntime.ts` 新增 `buildPiSubscriptionModelView()`——與 session 同源的 agentDir auth/models 建 ModelRuntime，逐 provider `getModels` 投影為 `{id,label,contextWindow,reasoning}`；agent dir 缺失／ModelRuntime 建構失敗／單一 provider 列舉失敗都收斂成 per-provider reason 字串，不會拖垮其他 provider。
- `src/agent/subscriptionCatalog.ts` 擴充 `providerModelError` 輸入（誠實 unavailable 原因的通道；verdict 順序固定 conflict → 無憑證 → runtime 錯誤 → 零模型 → available）+ `assembleSubscriptionCatalog()` 純組裝函式（Host 接線的唯一入口）。
- `electron/piHostEntry.ts` 啟動時組裝進 `config.subscriptionCatalog`（snapshot config 自動流經 settings/get 與 state/snapshot，零新 request path）。
- `electron/piHostProtocol.ts`：`PiHostConfigStatus.subscriptionCatalog?` 型別 + `PI_HOST_PROTOCOL_VERSION = 4`；initialize 接受 {4,3,2}——v2 相容是契約（70 個 fixture/qualify-pi-host 依賴），僅拒絕 v1。
- `electron/piHostSupervisor.ts` app client 改送 v4；`scripts/smoke-pi-host-protocol.mts` handshake 斷言升 v4。
- `smoke-subscription-catalog.mts` 新增 drift guards：piHostEntry 必須接線 assemble/build、protocol 必須是 v4 且保留 {3,2} 視窗、supervisor 必須送 v4。

驗證證據：

- `npx tsc -b` exit 0；`npm run build` 全綠
- `smoke-subscription-catalog` / `smoke-pi-host-protocol`（TS mode 與重建後 bundle 皆綠）/ `smoke-pi-child-session`（v2 相容）/ `smoke-pi-core-runtime` 全過
- 全鏈 `npm run smoke`（unset 污染 env 後）推進越過先前失敗點

⚠️ 環境備忘：本機 shell 若 export 了 `SUBAGENTS_PI_SYNC_CLI_OAUTH=true` 且存在 `~/.codex/auth.json`，host bootstrap 會把真實 codex OAuth 匯進 smoke 的隔離 agent dir，使 `smoke-pi-turn` 等「預期 No API key」的 smoke 變成 'answered'。跑鏈前需 `env -u SUBAGENTS_PI_SYNC_CLI_OAUTH`。這同時是 ADR-0052 鏈路的活體證明（匯入後 Pi loop 真的回答了），留給票 06 引用。
