# Release qualification hardening — qualification

Status: repository hardening resolved；Paid Beta release NO-GO

本 effort 的 automated repository work 已完成，但這不等於 release-ready 或 Paid Beta GO。權威 release report 仍是 [`app/release-evidence/paid-beta-qualification.md`](../../app/release-evidence/paid-beta-qualification.md)：目前缺少 coherent workflow receipts 與 signed-platform／clean-machine 等外部證據，因此為 **NO-GO（0/49）**。

## Readiness ladder

1. **compile success** — `npm run build`；只證明 TypeScript/Vite/Electron 可編譯。
2. **deterministic qualification** — `npm run qualify:deterministic`；無 App launch、無 signing credentials 的 blocking repository guards。
3. **platform qualification** — 明確的 macOS/Windows runtime、installer、signing/notarization 與 clean-machine jobs。
4. **release-ready** — `.github/workflows/release.yml` 對同一 immutable candidate/evidence attempt 完成核對。
5. **Paid Beta GO** — 只由 Paid Beta qualifier 在所有 49 criteria 有可信證據時宣告；目前仍 NO-GO。

`npm run smoke` 是完整 repository qualification。`build` 與 `dist:*` 始終只有 compilation/packaging 責任；plain-browser 只供 UI/degraded preview，不提供 production Pi Core Host execution。

## One-hop ticket evidence

| Ticket | Owning evidence |
|---|---|
| [01 Packaged change evidence](issues/01-packaged-change-evidence-schema.md) | `smoke-packaged-change-evidence.mjs` |
| [02 Candidate-only package jobs](issues/02-package-jobs-candidate-only.md) | `smoke-release-build-once.mts` + release workflow contract |
| [03 Verified channel promotion](issues/03-verified-channel-promotion.md) | `smoke-release-promotion.mjs` |
| [04 Credential vault contract](issues/04-credential-vault-expand-contract.md) | `smoke-credential-vault-contract.mts` |
| [05 Telegram/Webhook vault migration](issues/05-telegram-webhook-vault-migration.md) | `smoke:credential-vault` migration matrix |
| [06 Custom-tool vault migration](issues/06-custom-tool-vault-migration.md) | `smoke:credential-vault` custom-tool execution/migration matrix |
| [07 Legacy raw-secret removal](issues/07-remove-legacy-raw-secret-contract.md) | credential-vault deletion/boundary guards |
| [08 Atomic settings persistence](issues/08-atomic-settings-persistence.md) | `smoke-settings-persistence.mts` + lifecycle E2E |
| [09 No-App deterministic qualification](issues/09-no-app-launch-deterministic-qualification.md) | `smoke-deterministic-qualification.mts` |
| [10 Merge-base complexity](issues/10-merge-base-complexity-qualification.md) | `smoke-complexity-merge-base.mts` |
| [11 Shipped-runtime CI coverage](issues/11-shipped-runtime-ci-coverage.md) | `smoke-ci-shipped-runtime-coverage.mts` |
| [12 Critical hardening qualifier](issues/12-critical-release-hardening-qualification.md) | `smoke-release-hardening-qualification.mts` + workflow-owned receipt |
| [13 Route lazy loading](issues/13-route-level-lazy-loading.md) | `smoke-route-lazy-loading.mts` + production build measurement |
| [14 Task admission/finalization](issues/14-task-run-admission-finalization-prefactor.md) | `smoke-task-run-admission-prefactor.mts` + finalization/ingress smokes |
| [15 Pi Host turn routing](issues/15-pi-host-turn-routing-prefactor.md) | `smoke-pi-host-turn-routing-prefactor.mts` + Host turn behavior smokes |
| [16 External CLI parsers](issues/16-external-cli-provider-parser-prefactor.md) | `smoke-external-cli-provider-parsers.mts` + durable harness |
| [17 Startup recovery phases](issues/17-startup-recovery-phase-prefactor.md) | `smoke-startup-recovery-phases.mts` + reattach/restart smokes |
| [18 Smoke ownership migration](issues/18-smoke-ownership-and-source-guard-migration.md) | `smoke-qualification-ownership.mts` + `check-pi-contract.mts` |
| [19 Production unused policy](issues/19-production-unused-code-enforcement.md) | `check:unused-production` + `smoke-production-unused-policy.mts` |
| [20 Readiness rollup](issues/20-readiness-semantics-and-hardening-rollup.md) | `smoke-release-hardening-rollup.mts` + tracker-link health |

## Current result

- Focused ticket smokes: pass.
- `npm run build`: pass.
- Production unused-code policy: pass (0 unused diagnostics).
- Full `npm run smoke`: pass on 2026-09-01, including release, runtime, Pi Host, orphan-closure, and Electron E2E gates.
- Signed Windows/macOS, clean-machine install, N-1→N, entitlement/workflow/trust publication receipts: absent locally; Paid Beta remains NO-GO.
