# 16 — Main 擁有 deploy / effective Guard Mode

**What to build:** 讓 Electron 正式執行時的 Outbound Guard Mode 以 main 讀到的部署設定為權威：host 設為 `required` / `optional` / `demo` / `off` 時，Task run、LLM 出站、CLI 啟動與 Settings/Dashboard 姿勢標籤都使用同一份快照，而不是 renderer 自己的 env 或缺省 `off`。未知部署值仍必須明確失敗，不可靜默降弱。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 以 main 為權威解析 `SUBAGENTS_OUTBOUND_GUARD`，並經現有 outbound status / 等價 IPC 暴露 immutable deploy + effective mode 快照給 renderer。
- [x] settings load + Settings 頁 hydrate `outboundGuardDeploy`；`effectiveOutboundGuardFromSettings` 優先 main 快照（coordinator / LLM / CLI 共用 settings）。
- [x] `settingsPatchFromOutboundStatus` / `applyMainOutboundStatusToSettings`：required 不被 env off 削弱；invalid 不寫 silent off。
- [x] Dashboard 出站閘門用 `effectiveOutboundGuardFromSettings(settings)`，不讀 renderer `SUBAGENTS_OUTBOUND_GUARD`。
- [x] 未知部署值 → patch fail-closed（invalid 不寫入 deploy）。
- [x] `off` 與未啟用 optional 仍保持既有 pass-through 語義與效能路徑。
- [x] smoke：ticket16 cases in `smoke-outbound-gate.mts`（main snapshot + hydrate + Dashboard 契約）。

## Answer

- pure: `settingsPatchFromOutboundStatus` / `applyMainOutboundStatusToSettings`（main deploy → settings patch + effective）。
- `settingsStore.load` 呼叫 `outbound.status` 後 hydrate `outboundGuardDeploy`。
- Settings 頁 status effect 同步 patch；Dashboard 顯示 effective from settings。
- smoke-outbound-gate +5 ticket16 tests；frontier → 17 或 22。

## Parent

[spec-fail-closed-wiring.md](../spec-fail-closed-wiring.md) · review bugs 1, 17（display）
