# SubDesign architecture deepening qualification

Date: 2026-08-30

Status: `resolved`

## One-hop reconciliation

- [Spec](spec.md)：五個 deep-module workstreams 全數完成，沒有新增第二個 runtime、renderer authority 或 desktop protocol。
- [Tickets](issues/)：#01–#05 均為 `resolved`；最後一票以 public Pi Host Protocol 與 deletion guard 驗證 domain ownership。
- [DEV_STATE](../../DEV_STATE.md) 與 [tracker index](../INDEX.md)：同步記錄本 effort 5/5 resolved。

## Pi Host dispatch evidence

- `electron/piHostSessionDomain.ts` 完整擁有 `sessions/*` 的 list/create/fork/reset/compact/record 行為。
- `electron/piHostRunDomain.ts` 完整擁有 queue `runs/*`，並以唯一 Host journal port 接入 attachment/finalization。
- `electron/piHostToolDomain.ts` 擁有 `tools/*`、`approvals/*`、catalog、frozen contract projection 與 approval resolution；實際執行只經一個 Host-only executor port。
- `electron/piHostProtocol.ts` 只保留公開 protocol validation、domain routing、normalized response/event handling，以及 cursor-based canonical commit。
- `scripts/check-pi-contract.mts` 是 deletion-test guard：要求三個 domain 的 import/call 存在，且禁止 main dispatcher 重新出現 session/run/tool/approval method branches。

## Release gates

| Gate | Result | Evidence |
|---|---|---|
| Typecheck / build | PASS | `cd app && npm run build`，包含 complexity、production-owner、Pi contract、TypeScript 與 renderer/Electron builds。 |
| Touched-source lint | PASS | `cd app && npx oxlint electron/piHostProtocol.ts electron/piHostRunDomain.ts electron/piHostSessionDomain.ts electron/piHostToolDomain.ts`，無 warnings。 |
| Pi contract guard | PASS | `cd app && node --experimental-strip-types scripts/check-pi-contract.mts`。 |
| Pi Host protocol suite | PASS | `cd app && npm run smoke:pi-host`，完整 Host protocol/session/run/tool/approval/restart 套件通過。 |
| Workspace text-search owner guard | PASS | `cd app && node --experimental-strip-types scripts/smoke-workspace-text-search.mts`，21/21。 |
| Full repository smoke | PASS | `cd app && npm run smoke`，單一非重疊程序 exit 0；包含 recovery E2E、Pi parity、Pi Electron Host E2E 與 tracker guards。 |

完整 smoke 中 Electron review-finalize fixture 仍會輸出預期的 unavailable stderr，且 E2E 最終通過；Vite 既有 dynamic-import／large-chunk warnings 亦未升級為失敗。
