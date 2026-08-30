# Host-owned Agent Collaboration — qualification

日期：2026-08-30

## 結論

Host-owned collaboration lifecycle 已完成本機 release qualification。Pi Core Host 是 agent tree、mailbox、follow-up、wait、settlement、write lease、worktree 與 adoption 的唯一 production authority；renderer 只消費 snapshot + cursor projection。完整 smoke 與 packaged Electron 路徑均通過。

本機沒有 Apple Developer ID 與 notarization credentials，因此產物僅能作為 **unsigned local test build**，不得發佈。這是外部簽章資格，不是 collaboration runtime failure；正式 distributable gate 仍由 `.scratch/INDEX.md` 的 paid-beta signed-platform residual 追蹤。

## Lifecycle 證據

- `npm run smoke:agent-collaboration`：真 Pi parent/child spawn、queue-only mail、idle/running follow-up、event-driven wait、one-hop completion、duplicate suppression、reload/recovery、retention 與 restrictive profile 全綠。
- `npm run smoke`：完整主鏈全綠；包含 collaboration boundary、Pi Host protocol/queue/Turn Record、workspace conflict、Git worktree、Checker adoption、conversation projection、renderer reattach 與 external CLI honesty。
- Electron renderer reattach E2E：2 個 active + 2 個 terminal case 通過；terminal result 在 reload 後沒有遺失或重複。完整鏈曾出現一次 attachment cleanup timing flake，未修改程式後 focused retry 全綠。
- Write authority：overlap 在 effect 前 fail closed，canonical project-relative scope 與 symlink/traversal 防護由 Host 驗證；protected workspace 不發生未授權寫入。
- Verified worktree：Host 建立並驗證 branch/baseline/workspace identity，child cwd 限定於隔離 worktree，主 checkout 不被修改，結果只進 review workflow、不自動 apply/merge。
- Checker adoption：child final text 維持 observation；只有 trusted、current、sibling-settled evidence 能採用，stale/missing evidence 不推進 Working State。
- UI attribution：collaboration row 綁定 originating Chat turn；下一輪 active surface 不帶入上一輪 activity，archive/replay 仍由同一 Turn Record 展開。

## Release gate

- `npm run build`：通過。
- `npx oxlint src`：exit 0；只有 `SettingsPage` 既有 3 項 unused warnings，無 error。
- `npm run smoke`：完整主鏈通過。
- `npm run dist:mac`：icons、build、package-time smoke、`smoke:built`、x64/arm64 electron-builder 全部完成；最後 only 因沒有 Apple Developer ID/notarization credentials，以 distributable signature gate exit 1。
- `ALLOW_UNSIGNED_MAC_BUILD=1 node --experimental-strip-types scripts/verify-mac-release-signature.mts`：同一批 artifacts 以專案既有 explicit unsigned-local policy 通過；輸出明確禁止 publish。

產物：

| Artifact | Size | SHA-256 |
|---|---:|---|
| `app/release/AgentStudio-1.1.0.dmg` | 254 MB | `5d240f4e9e4ddc08a8615d48dab07af44f808433daf735504a95c3f41094feb9` |
| `app/release/AgentStudio-1.1.0-arm64.dmg` | 253 MB | `6642621b54054c0d9a82df14b312c34bc8d1cd46c87a952a1be913986597f430` |

## 一 hop ownership

- Protocol/runtime owner：`app/electron/piAgentCommunicationDomain.ts`
- Workspace authority：`app/electron/piAgentWorkspaceAuthority.ts`
- Shared renderer/Host contract：`app/src/agent/agentCollaboration.ts`
- Canonical history：`app/src/agent/turnRecord.ts` + Host lifecycle recorder
- UI projection：`app/src/agent/agentWorkTreeProjection.ts` / `app/src/components/AgentWorkTree.tsx`
- Single run admission：`app/src/agent/taskRunCoordinator.ts`，Host queue 只經 `hostAgentQueuePump.ts` 進入 `runTask`

