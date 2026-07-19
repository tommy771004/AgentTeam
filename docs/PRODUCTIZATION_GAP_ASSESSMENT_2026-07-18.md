# SubAgents AI 產品化差距評估

> 評估日期：2026-07-18  
> 目標：Windows 10/11 與 macOS 正式支援的可收費 Beta  
> 對標：ChatGPT desktop app 中的 Codex、Claude Desktop Code、OpenCode Desktop

## 1. 結論

SubAgents AI 已經不是「缺少核心引擎的原型」。最新本機驗證中，build、100 項 capability smoke、16 項 scenario E2E 與 36 項 production-module 測試均通過。Canonical task ingress、四種 Loop Pattern、權限、外部 CLI runner、capabilities、MCP、skills、automations、queue、worktree delegation、rewind、diff summary 與 local archive 都已有實作基礎。

但它目前仍適合 **Internal Alpha / invited free technical preview**，不適合直接作為 Windows + macOS 付費 Beta 發布。

兩個分數必須分開看：

| 判準 | 目前完成度 | 尚餘差距 |
| --- | ---: | ---: |
| 核心 coding-agent／控制中心能力 | 約 76% | 約 24% |
| Windows + macOS 可收費 Beta readiness | 約 41% | 約 59% |
| 依產品目標加權的整體完成度 | **約 55%** | **約 45%** |

最重要的判讀是：**核心能力領先於產品化能力**。下一階段若繼續增加 agent features，對上市距離的改善有限；最高槓桿工作是建立可信的雙平台發布、復原、授權與 onboarding 鏈。

若由一個熟悉此 repo 的主要開發者配合 AI 執行，達到受邀付費 Beta 的合理工作量估計是 **12–18 個工程週**；若要求兩個 OS 都有 clean-machine、簽章、公證、升級與崩潰演練的保存證據，日曆時間通常不應壓縮成純功能開發天數。

## 2. 已確認的產品決策

- 首要客群：個人重度開發者與 3–20 人小型開發團隊。
- 定位：跨 Codex、Claude Code、OpenCode 的 Local-first 桌面代理控制中心。
- 核心體驗：Spec → Tickets → TDD → Code Review → 可合併結果。
- 平台：Windows 10/11 與 macOS 都是正式支援，不標 Preview。
- 原始碼：閉源商業產品。
- 免費核心：對標 OpenCode 的完整 coding-agent 工作台。
- 訂閱價值：進階編排、自動化、可靠性與時間節省。
- 架構：單一免費核心；登入訂閱後下載／啟用已簽章的訂閱功能包。
- 計價：固定席次，無 token、代理或任務用量計費。
- Beta 價格假設：US$9／月、US$90／年。
- 核准模式：要求核准／代我核准／完整存取權；全域預設可由每次對話覆寫。
- 交付：Artifact Index → 使用者從對話框 `+` 選擇建立本機 Handoff 文件；不自動上傳或傳送。
- 信任：產品網站必須公開 Local-first 安全白皮書、資料流、遙測清單與隱私政策。

## 3. 加權評分

| 維度 | 權重 | 得分 | 證據與判讀 |
| --- | ---: | ---: | --- |
| 核心執行與跨供應商編排 | 25 | 22 | Coordinator、四種 loops、builtin/external runners、queue、delegation、automations 與能力系統完整；external CLI 的 parse/DoD/iterate 能力仍刻意降級。 |
| 日常桌面 coding workflow | 20 | 13 | 有 project/worktree、terminal、rewind、run summary diff；欠缺競品等級逐行 review、PR/CI workflow、每 session 預設隔離與 editor continuation。 |
| 安全、可靠性與驗證 | 15 | 11 | 權限、unattended 降級、deny override、vault、retry/circuit breaker、smoke matrix 良好；欠缺 process crash reconciliation、損壞資料復原與 packaged-app E2E。 |
| Windows/macOS 發布鏈 | 15 | 4 | NSIS 與 dual-arch DMG target 已配置；沒有 macOS CI、簽章、公證、release workflow、clean install/upgrade/uninstall 或 auto-update。 |
| 商業化與 entitlement | 15 | 1 | 尚無產品網站、checkout、訂閱、授權、entitlement、功能包簽章與離線寬限。 |
| Onboarding、信任與營運 | 10 | 4 | CLI discovery、settings、local archive/audit foundation 已有；欠缺首次成功導引、公開安全文件、支援流程、release notes、crash feedback。 |
| **合計** | **100** | **55** | **Paid Beta No-Go；Internal Alpha 可行。** |

## 4. 官方競品基準

✓ = 官方明載；△ = 部分或客戶端限定；— = 截至評估日未見官方已交付證據，不代表絕對不存在。

| 維度 | Codex | Claude Code Desktop | OpenCode Desktop | SubAgents AI 現況 |
| --- | --- | --- | --- | --- |
| 本機／遠端 | ✓ local + cloud environment | ✓ local/cloud/SSH/WSL | △ local + web/server remote attach | △ Local-first；webhook/Telegram，不是 remote coding runtime |
| 多 session／agents | ✓ parallel chats/projects | ✓ parallel sessions；agent teams CLI only | ✓ tabs + primary/subagents | ✓ opt-in capped concurrency + delegate/background jobs |
| Worktree isolation | ✓ desktop + scheduled worktrees | ✓ local Git session 自動 worktree | — 未見官方同等證據 | △ delegate 可選 worktree；失敗會回退共享 workspace |
| Diff／review | ✓ `/review`、cloud diff/PR | ✓ visual diff、line comments、CI/PR monitoring | △ diff viewer | △ run summary Git diff；欠逐行評論與 PR lifecycle |
| Skills／plugins／MCP | ✓ | ✓ | ✓ | ✓ capability/skills/plugin/MCP 系統完整 |
| Automations | ✓ scheduled local/worktree | ✓ scheduled；Desktop scripting 不提供 | — 未見 desktop recurring scheduler | ✓ scheduler、event matcher、webhook、Telegram、background delegates |
| Permissions／recovery | ✓ sandbox + approvals | ✓ 5 permission modes + auto verify | ✓ allow/ask/deny + Plan | ✓ 3 approval modes、plan、rewind、checkpoint；欠 process crash recovery |
| IDE／terminal | ✓ integrated terminal + IDE | ✓ terminal/editor/panes + IDE continuation | ✓ TUI/IDE integration | △ floating/in-app terminal；欠成熟 IDE continuation |
| Distribution/update | ✓ Windows/macOS 正式發行；update contract 未見官方明載 | ✓ Windows/macOS 啟動時 auto-update | △ Desktop BETA，多平台 packages；update contract 未見官方明載 | ❌ target 有、可信發布鏈未完成 |
| Team/admin | ✓ RBAC/managed controls | ✓ managed settings/MCP/SSH allowlist | △ central config/SSO/gateway | — 首版刻意延後，先用 portable Handoff |

官方來源：

- Codex：[App](https://developers.openai.com/codex/app)、[Worktrees](https://developers.openai.com/codex/app/worktrees)、[Code review](https://developers.openai.com/codex/code-review)、[Automations](https://developers.openai.com/codex/automations)、[MCP](https://developers.openai.com/codex/mcp)、[Skills](https://developers.openai.com/codex/skills)、[Integrated terminal](https://developers.openai.com/codex/integrated-terminal)。
- Claude：[Desktop reference](https://code.claude.com/docs/en/desktop)。
- OpenCode：[Website](https://opencode.ai/)、[Docs](https://opencode.ai/docs/)、[GitHub](https://github.com/anomalyco/opencode)、[Agents](https://opencode.ai/docs/agents/)、[Permissions](https://opencode.ai/docs/permissions/)、[Plugins](https://opencode.ai/docs/plugins/)。

## 5. SubAgents AI 的真實優勢

不應把產品描述成較小的 Codex／Claude 複製品。現有差異化應集中在：

1. **跨供應商控制面**：同一產品協調 Codex、Claude Code、OpenCode 與其他 local CLI。
2. **任務 loop 明確化**：Turn/Goal/Time/Proactive 是產品層概念，不只是一個聊天 session。
3. **Unattended automation**：scheduler、strict event evidence、webhook、Telegram、queue 與 background delegates 已經形成較完整的自動化面。
4. **Capability runtime**：deferred loading、Tool Search、CodeMode、capability approval 與 resume state 是可銷售的進階編排基礎。
5. **Portable handoff**：不用先建立雲端協作服務，也能把 indexed artifacts 壓縮成交付文件。

訂閱版應販售這些能力的可靠組合，而不是把基本 CLI、MCP、diff 或多 session 人為鎖住。

## 6. Paid Beta P0 上市阻斷項

### P0-1：可信雙平台 release pipeline

目前 `.github/workflows/ci.yml` 只有 Ubuntu/Windows verify，不執行原生 packaging，也沒有 macOS job、artifact upload 或 release workflow。

完成條件：

- Windows 與 macOS 原生 runner 分別 build/package。
- tagged release 產生 immutable artifacts、SHA-256、SBOM/provenance。
- required jobs 不可 `continue-on-error`。
- 保存 installer、logs、verification report 與 release notes。

### P0-2：簽章、公證與更新

現有 Windows installer 與 unpacked EXE 的 Authenticode 狀態是 `NotSigned`；macOS config 沒有 hardened runtime、entitlements、notarization 或 stapling；repo 沒有 auto-updater/update channel。

完成條件：

- Windows installer/EXE Authenticode `Valid`，有 timestamp 與 trusted publisher。
- macOS `codesign --verify`、Gatekeeper `spctl`、notarization accepted、ticket stapled。
- signed beta update metadata、N-1→N 更新、下載驗證與失敗更新復原。

### P0-3：安裝後 E2E 與資料 migration

目前 smoke 驗證 Vite/build module contract，不代表 NSIS/DMG 安裝後的 app 可在乾淨電腦上可靠工作。

完成條件：

- Windows clean VM、macOS Intel 與 Apple Silicon clean install。
- 啟動 → CLI discovery → builtin/local CLI task → restart → persisted thread/settings/queue。
- uninstall；N-1→N upgrade；失敗 upgrade/rollback policy。

### P0-4：崩潰與中斷復原

目前沒有 main/renderer/child process crash handling 的完整證據；active run 未 journal；scheduler 的 `running` 狀態缺少啟動 reconciliation；損壞 thread storage 可能回退空資料。

完成條件：

- 強制 renderer/main kill 後，active run/job 被標記 `interrupted`。
- Queue exactly-once 恢復，once-job 不重複執行。
- primary state 損壞時可從 last-known-good backup 復原或隔離並提示。
- 顯示本機 recovery report；crash upload 必須依公開隱私政策選擇。

### P0-5：訂閱、entitlement 與功能包供應鏈

完成條件：

- 免費核心無登入即可使用。
- 訂閱 checkout、帳號/授權、裝置管理、退款與取消流程。
- entitlement cache 與合理離線寬限。
- 付費功能包有 manifest、版本相容範圍、簽章、hash、rollback 與 uninstall。
- 取消訂閱後既有資料仍可讀取及匯出。

### P0-6：首次成功與閉源信任

完成條件：

- 首次啟動檢查 Git、Codex、Claude Code、OpenCode 與登入狀態。
- 提供可跳過的 guided first task，完成一次 diff/review/handoff。
- 公開安全白皮書、資料流、所有外連 endpoint、遙測欄位、資料保存與刪除政策。
- 提供 EULA、服務條款、退款／取消、資料匯出與完整刪除政策。
- 應用程式內可查看目前版本、license、network/telemetry 狀態與本機資料位置。

### P0-7：Electron 與 secrets 安全加固

目前主視窗已使用 `contextIsolation: true`、`nodeIntegration: false`，但仍有 `sandbox: false`；主視窗缺少明確 packaged CSP 與 navigation/permission allowlist，`shell.openExternal` 需要限制 scheme。`secretsVault` 在 OS `safeStorage` 不可用時會退回 `PLAIN` 儲存。

完成條件：

- 記錄並驗證 renderer sandbox 決策；主視窗使用 production CSP。
- navigation、window open、permission request 與外部 URL 僅允許明確 schemes/domains。
- OS secure storage 不可用時拒絕保存 secrets，或以強烈提示與明確 consent 降級，不能靜默明文保存。
- 設定匯出維持 secret redaction，並對敏感 metadata 提供清楚 consent、加密選項或文件化風險。
- dependency audit、secret scan 與安全例外清單成為 release gate。

## 7. P1：競品體驗差距

以下不是第一個付費 Beta 的全部阻斷，但會影響日常主工具替代率：

- 每個 coding session 預設 worktree 隔離，而不是 delegate 選配且可靜默回退。
- 視覺化 file-by-file diff、逐行 comment、接受／捨棄 hunk。
- GitHub PR 建立、CI status、review finding → auto-fix loop。
- IDE continuation 與「在 editor 開啟變更」。
- Local/Worktree session 互轉與清楚的 apply/cleanup lifecycle。
- 支援／診斷 bundle、release rollback 與版本相容性矩陣。
- macOS/Windows 原生 UX 細節、快捷鍵、通知與背景生命周期。

Remote managed coding、SSH session、手機遙控、企業 SSO/RBAC/audit 不列入首個付費 Beta P0；它們屬於後續團隊版或 parity roadmap。

## 8. 建議交付順序

### Phase A — Release foundation

- [ ] 雙平台 release CI。
- [ ] Windows signing、macOS signing/notarization。
- [ ] checksums、SBOM、provenance、release notes。
- [ ] packaged-app clean-install smoke。

### Phase B — Recovery and trust

- [ ] active-run journal 與 startup reconciliation。
- [ ] corrupt-state backup/quarantine/recovery。
- [ ] updater、failed-update recovery、release rollback runbook。
- [ ] security/privacy/telemetry 文件。
- [ ] Electron CSP/sandbox/navigation/permission hardening。
- [ ] secure-storage unavailable policy 與 export consent。

### Phase C — Product and revenue

- [ ] 免費／訂閱 entitlement service。
- [ ] signed subscription feature packs。
- [ ] checkout、device activation、offline grace、cancel/refund。
- [ ] **建立產品網站**：定位、下載、方案比較、checkout、Local-first、安全與隱私。

### Phase D — Core paid workflow

- [ ] Artifact Index。
- [ ] 對話框 `+` 的 Handoff 產生選項。
- [ ] Spec → Tickets → TDD → Review workflow pack。
- [ ] 自動品質閘門、失敗修復與可審核結果。
- [ ] 核准模式移到 composer，支援 per-run override。

### Phase E — Daily-driver parity

- [ ] session-first worktree lifecycle。
- [ ] rich diff + inline comments。
- [ ] PR/CI/review integration。
- [ ] IDE continuation。

## 9. 最新驗證證據

在 `app/` 執行：

- `npm run build`：通過；有 956 kB main chunk 與 ineffective dynamic import warnings。
- `npm run smoke:ci`：通過；9 core + 22 platform + 100 capability + 16 scenario + 36 production-module tests。
- `npx oxlint src electron`：exit 0；仍有 10 warnings。
- `Get-AuthenticodeSignature`：現有 Windows installer/EXE 為 `NotSigned`。

Beta release gate 應將 lint warnings 清零或建立明確受控 baseline，並把 packaged Electron E2E 納入 required CI。

## 10. Stop condition

只有在下列證據全部可由 release artifact 重現時，才將 Paid Beta 從 No-Go 改為 Go：

1. Windows/macOS signed native artifacts。
2. macOS notarization/stapling 與 Windows signature verification。
3. clean install/launch/core task/restart/uninstall。
4. N-1→N migration 與 failed-update recovery。
5. forced crash/corrupt-state recovery。
6. entitlement/feature-pack/license lifecycle。
7. onboarding、產品網站、安全與隱私文件。
