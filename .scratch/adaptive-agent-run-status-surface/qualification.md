# Adaptive Agent Run Status Surface qualification

Date: 2026-08-30

Status: `resolved`

## One-hop reconciliation

- [Spec](spec.md)：兩層資訊架構、trust boundary、replay 與 accessibility 決策皆由本次實作落地。
- [Ticket #01](issues/01-adaptive-run-status-surface.md)：13 項 acceptance 只有在 rendered 與完整 release gates 通過後才標記完成。
- [DEV_STATE](../../DEV_STATE.md) 與 [tracker index](../INDEX.md)：同步記錄本 effort 1/1 resolved。

## Implementation evidence

- `src/agent/runStatusSurface.ts` 是單一純 UI Projection owner；只讀 frozen runner capabilities、bounded lifecycle/activity、Host Working State、attention 與 terminal facts。
- 第一區只使用 bounded runtime vocabulary，顯示「執行狀態」、elapsed time 與最後更新；objective、assistant text、instruction bodies、constraints、absolute paths 與 raw output 不參與文案。
- 第二區依 evidence 選擇「任務進度」、「最近活動」、「需要你處理」或「執行摘要」；沒有實質內容時不渲染。
- Archive 與 live rail 共用 `projectRunStatusSurface`；renderer archive 的 Working State 仍保持 unverified，不因重播而提升 Host guarantee。
- Working State revision、runner guarantee、constraints 與 evidence identities 僅在鍵盤可操作、預設收合的「執行資訊」中顯示。

## Release gates

| Gate | Result | Evidence |
|---|---|---|
| Rendered state matrix | PASS | `cd app && npm run smoke:run-status-surface`；真正 `InlineRunPanel` 覆蓋 builtin、External CLI、approval/auth/input、completed/failed/cancelled、simple-hide、hostile context、reload 與 accessibility。 |
| Existing capability guards | PASS | `cd app && node scripts/smoke-caps.mjs`，91/91；archive persistence guard 重新指向抽出的 canonical owner。 |
| Build / typecheck | PASS | `cd app && npm run build`。 |
| Lint | PASS | `cd app && npx oxlint src`，exit 0；保留 `SettingsPage` 三個既有 unused warnings。 |
| Full repository smoke | PASS | `cd app && npm run smoke`，單一非重疊程序 exit 0；rendered status smoke 已掛主鏈並實際通過。 |

## Rendered evidence

- [Builtin task progress](evidence/ui-2026-08-30/builtin-progress.png)
- [External CLI recent activity](evidence/ui-2026-08-30/external-activity.png)
- [External CLI terminal summary](evidence/ui-2026-08-30/terminal-external.png)

畫面檢查確認 compact rail 沿用既有排版與色彩，沒有新增 template card、glow、fake percentage、空 placeholder progress 或水平 overflow。只有 primary lifecycle 使用 polite status；activity list 沒有 live-region。
