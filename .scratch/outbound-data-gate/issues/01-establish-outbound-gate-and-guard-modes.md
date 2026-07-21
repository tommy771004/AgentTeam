# 01 — 建立統一出站閘門與 Guard Mode

**What to build:** 讓每個 builtin LLM 呼叫與 external CLI 啟動都先經過同一個 Outbound Data Gate，並從部署設定與使用者設定導出可理解、可顯示的 `off`、`demo`、`optional`、`required` 有效模式。這張票先建立可擴充的 pass-through 邊界；`off` 必須維持既有行為，其他模式則能可靠進入後續安全處理而不產生旁路。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 所有 builtin LLM round，包括後續 function-calling round，都會在實際 transport 前呼叫同一個 Outbound Data Gate。
- [x] external CLI 在建立 process 前會經過同一個 Outbound Data Gate，且 UI 或其他入口不能直接繞過它。
- [x] `SUBAGENTS_OUTBOUND_GUARD` 可接受 `off`、`demo`、`optional`、`required`；未知值會明確失敗而非選擇較弱模式。
- [x] `required` 在 Settings 顯示為公司強制且不可由使用者關閉；`optional` 提供可持久化且可即時套用的開關。
- [x] `demo` 顯示非企業保障警示；`off` 保持現有 LLM 與 CLI payload、成功/失敗語義及效能路徑。
- [x] build flavor 與 guard mode 在執行期是不同概念，任何 build flavor 都不能自行形成 bypass。
- [x] 高層 scenario harness 能從 canonical Task run 送到 fake LLM 與 fake CLI，並證明每個 transport 都經過 gate 一次。
- [x] composer、scheduler、webhook、Telegram、delegate 與 retry 仍只透過 canonical Task run ingress，不新增 runner 或 UI dispatch 路徑。


## Answer

- `src/agent/outbound/outboundGate.ts`：`parseDeployOutboundGuard` / `resolveEffectiveOutboundGuard` / `inspectOutbound` / build-flavor 正交。
- 未知 `SUBAGENTS_OUTBOUND_GUARD` 拋錯；empty → `off`。
- `required` 不可由 UI 關閉；`optional` → `outboundProtectionEnabled` 持久化開關；`demo` 警示；`off` pass-through（`inspected:false`）。
- `chatCompletionWithTools` 與 `runPromptViaLocalCli` 在 transport / process 前呼叫同一 gate。
- Settings 顯示模式；smoke-outbound-gate（10 tests）掛入 smoke / smoke:ci。
- Build flavor 不形成 bypass。

