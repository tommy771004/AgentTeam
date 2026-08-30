# Run Review Workspace qualification

Date: 2026-08-30

Status: `resolved`

## One-hop reconciliation

- [Spec](spec.md)：完整生命週期與 immutable snapshot correctness invariant 已實作並通過 release gates。
- [Release ticket #15](issues/15-release-qualification.md)：六項 acceptance 均有可重跑證據後才標記完成。
- [ADR-0054](../../docs/adr/0054-run-review-snapshots-are-immutable-host-artifacts.md)：歷史審查由 Host-owned immutable artifact 提供，不 fallback 至目前 working tree。
- [DEV_STATE](../../DEV_STATE.md) 與 [tracker index](../INDEX.md)：同步記錄本 effort 15/15 resolved。
- [Real runner report](evidence/real-runner-qualification.md)：真 Electron builtin 與 Codex CLI qualification 的安全摘要。

## Release gates

| Gate | Result | Reproduce / evidence |
|---|---|---|
| Build / typecheck | PASS | `cd app && npm run build` |
| Lint | PASS | `cd app && npx oxlint src`，exit 0；保留 `SettingsPage` 三個既有 unused warnings。 |
| Review focused chain | PASS | `cd app && npm run smoke:review-workspace-binding`；contract、SQLite artifact lifecycle、Git fixtures、snapshot capture/projection、settlement/recovery、comments/follow-up、verification、mutation/delivery 與 Electron E2E 全綠。 |
| Real runners | PASS | `cd app && npm run qualify:review-real-runners`；builtin `openai-codex / gpt-5.6-luna` 與 Codex CLI 均產生可信 execution proof，詳見 [report](evidence/real-runner-qualification.md)。 |
| Full repository smoke | PASS | `cd app && npm run smoke`，2026-08-30 單一非重疊程序 exit 0；review focused chain 已掛在主鏈。 |
| Complexity gate | PASS | `cd app && npm run check:complexity`；本輪拆分 Host protocol/runtime、capture/delivery coordinator 與 Review UI owner。 |

## Correctness and recovery evidence

- Electron E2E 覆蓋 run → snapshot → reload/restart → review → comment/feedback → new snapshot；builtin 與 external CLI 都走 production seam。
- historical snapshot A 在 working tree mutation、commit 與 snapshot B 建立後仍以原 bytes/hash 重播；shared checkout 明確降級為 `shared`／`partial`，不宣稱 Agent 精確歸屬。
- stage／revert 使用 revision CAS；stale、deny、crash/restart recovery，以及 commit／push／PR error matrix 由 mutation與 delivery focused smokes覆蓋。
- missing、failed、partial、binary 與 large-diff paging 都是明確狀態；immutable target 缺失時不讀取 live working tree 作替代。

## Rendered UI evidence

真 renderer fixture 使用 205 files 與大型 diff，檢查 desktop／320px narrow、paging、keyboard file navigation、搜尋、focus、overflow，以及 partial／shared、binary、missing／error states。

- [Desktop](evidence/ui-release-2026-08-30/desktop.png)
- [320px narrow](evidence/ui-release-2026-08-30/narrow.png)
- [Error state](evidence/ui-release-2026-08-30/error.png)
- [Missing state](evidence/ui-release-2026-08-30/missing.png)

## Resolution boundary

Release gate 所需的本機、真 Electron 與真 runner 證據皆已具備，沒有以外部環境缺席或偽造結果代替 acceptance。後續功能變更必須繼續維持 ADR-0054 的 immutable historical review 與 mutation fail-closed 邊界。
