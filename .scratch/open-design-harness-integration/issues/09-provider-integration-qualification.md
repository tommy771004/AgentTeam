# 09 — Provider integration qualification

Status: 可交給代理

## Parent

[Integrate Open Design harness contracts into SubDesign](../spec.md)

## What to build

把已完成的 OpenDesign contract 與 providers 收斂為可發布的整體：鎖定 dependencies、記錄 license/provenance、驗證 lifecycle/concurrency/security/recovery，並讓使用者和維護者知道每個 experimental provider 的支援與降級範圍。

## Acceptance criteria

- [ ] 每個 bundled package/binary 記錄 exact version、source、license、content integrity 與更新方式；production 不使用 `latest`。
- [ ] Storybook MCP 的 experimental/feature-flag 狀態、Harness 的 alpha/platform requirements 與 MCP Apps host support 都有使用者可見說明。
- [ ] TypeUI 在授權與服務條款未通過前沒有 vendored content 或 runtime dependency；Playwright MCP 沒有建立重複 browser loop。
- [ ] 完整 smoke 從 contract loading、snapshot/grant、Task run、context/evidence providers、interactive surface 到 streaming artifact 全程使用 shipped modules。
- [ ] Concurrency smoke 證明不同 conversations 在容量內並行、同一 conversation 有序、每個 external session 可 targeted cancel。
- [ ] Security smoke 證明 renderer 無 raw token path、sandbox 無任意 tool/network authority、unknown capabilities fail closed、model 無法製造 evidence。
- [ ] Recovery smoke 證明 navigation/reload 可由 Host snapshot/events 重建 activity、surface draft、evidence 與 artifact，archived tombstone 不會被復活。
- [ ] Settlement smoke 證明 provider success、stage success、DoD met、blocked、failed 與 cancelled 保持可區分。
- [ ] Build、lint 與完整 smoke chain 通過；任何既有 source drift guard 都沒有被削弱或改成 mirrored implementation。
- [ ] 文件說明 plugin author contract、provider trust boundary、capability grants、fallback behavior 與 pinned update process。
- [ ] 最終手動驗證包含 Storybook context、DevTools findings、Harness cancel、MCP Apps fallback 與 streaming artifact reload。

## Blocked by

- 04 — Storybook component context provider
- 05 — Chrome DevTools Critique evidence provider
- 06 — Harness goal-based UX testing
- 07 — MCP Apps direction、form、confirmation surfaces
- 08 — Streaming artifact envelope 與 sandbox renderer
