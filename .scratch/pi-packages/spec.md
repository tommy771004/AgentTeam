# Pi Packages 本機安裝與共享使用

> 狀態：`resolved`

## Problem Statement

AgentStudio 已以 Pi Core 作為 builtin agent runtime，但使用者無法在應用程式內探索、安裝或管理 Pi Packages。即使使用者知道 `pi.dev/packages` 上有合適的套件，仍必須離開 AgentStudio、理解 Pi CLI 與本機設定位置，並自行判斷安裝後哪些資源真的能被 Agent Chat 或 SubDesign 使用。現有「擴充能力」主要管理 curated connectors 與 MCP integrations，不是 Pi package lifecycle；若直接把下載按鈕接到 renderer 或沿用既有 plugin installer，會產生第二套 package authority，且可能讓具有完整本機權限的第三方程式碼繞過 Host trust、active-tool admission、approval 與 Turn Record contract。

## Solution

在 Settings 新增「Pi Packages」功能頁，讓使用者搜尋可識別的 Pi npm packages、查看來源與相容資源、明確接受完整本機權限警告後，以固定版本安裝到目前有效的 Pi user agent directory。安裝、列舉、移除、資源解析與 runtime reload 全部由 Pi Core Host 擁有，直接復用 vendored Pi package manager 與 resource loader，不建立第二套 installer 或 runtime。

v1 僅支援 `npm:<name>@<exact-version>` 的 user-scope package。Package skills 經 Host 納入每輪 frozen Skill Resource View；package extension tools 預設不具執行權，只有在使用者明確信任且通過既有 active-tool contract 後，才可在 Agent Chat 與 Pi-backed SubDesign run 中使用。Pi themes、TUI custom UI、Pi prompt／command integration 與 provider extensions 不宣稱相容。`pi.dev/packages` 作為發現與詳情入口；在沒有官方穩定 catalog API 前，不以 iframe 或 HTML scraping 建立脆弱的資料契約。

## User Stories

1. As an AgentStudio user, I want to find Pi Packages from Settings, so that I do not need to leave the app to discover compatible extensions and skills.
2. As an AgentStudio user, I want each package card to show its exact version, source, repository, and declared resource types, so that I can make an informed installation decision.
3. As an AgentStudio user, I want to open the corresponding pi.dev or npm detail page, so that I can review upstream documentation and source before trusting a package.
4. As a security-conscious user, I want a clear warning that Pi Packages are not sandboxed and may have full filesystem, process, network, environment, and credential authority, so that installation is an explicit trust decision.
5. As a security-conscious user, I want the warning to state that npm lifecycle scripts may execute during installation, so that I understand risk begins before an extension is enabled.
6. As an AgentStudio user, I want installation to require an explicit confirmation rather than a silent background action, so that third-party code is never trusted accidentally.
7. As an AgentStudio user, I want the app to install an exact package version, so that the code I approved cannot silently change because a moving tag resolves differently later.
8. As an AgentStudio user, I want package installation to use my effective Pi user agent directory, so that AgentStudio and its Pi Core Host agree on the installed state.
9. As an AgentStudio user, I want to see installation progress and a truthful terminal result, so that a failed npm operation is never presented as installed.
10. As an AgentStudio user, I want installed packages listed from Pi's persisted package settings and installed files, so that the UI does not drift from runtime truth.
11. As an AgentStudio user, I want to remove an installed package from Settings, so that I can revoke resources I no longer trust or need.
12. As an AgentStudio user, I want package changes to take effect on the next run without restarting the desktop app, so that newly installed resources become useful immediately after a safe runtime reload.
13. As a user with an active task, I want install and remove operations rejected while affected Pi runs are active, so that tools and skills cannot change underneath an executing turn.
14. As an Agent Chat user, I want an installed package skill to appear in the next Host-frozen skill view, so that the model can use the skill without reading mutable package files mid-turn.
15. As a SubDesign user, I want the same supported package skills available in Pi-backed design runs, so that Chat and SubDesign do not maintain separate skill installations.
16. As an Agent Chat user, I want a trusted package extension tool to be available only when it is active in the Host-issued tool contract, so that installed code cannot bypass model-visible capability admission.
17. As a SubDesign user, I want trusted package tools to follow the same Host contract as other Pi-backed tools, so that design runs retain approval and evidence semantics.
18. As an AgentStudio user, I want package extension tools disabled until I explicitly enable the trusted package, so that download state is not confused with execution authority.
19. As an AgentStudio user, I want incompatible package resources identified honestly, so that a package containing a Pi TUI theme or custom terminal UI is not advertised as fully usable in the React app.
20. As an AgentStudio user, I want a package with only unsupported resources to be marked unsupported for v1 before activation, so that installation does not create a false expectation of functionality.
21. As an AgentStudio user, I want package diagnostics to identify which skills and extension tools were discovered, so that I know what the installation actually contributed.
22. As an AgentStudio user, I want package provenance to include source and version in runtime evidence, so that I can identify which third-party package supplied a tool or skill.
23. As an approval reviewer, I want package tool calls to retain the existing approval and outbound-data policies, so that installing a package does not weaken established security controls.
24. As an audit reviewer, I want package-backed tool activity represented in Turn Record evidence, so that replay can distinguish builtin, MCP, extension-pack, and Pi package behavior.
25. As an AgentStudio maintainer, I want Pi Core Host to be the sole package lifecycle authority, so that renderer state cannot claim a package is installed or trusted.
26. As an AgentStudio maintainer, I want to reuse the vendored Pi package manager and resource loader, so that package source parsing, persistence, and layout semantics do not fork from upstream Pi.
27. As an AgentStudio maintainer, I want the existing connector/MCP marketplace to remain conceptually separate from Pi Packages, so that the two installation domains do not acquire ambiguous ownership.
28. As an AgentStudio maintainer, I want package operations exposed through the versioned Pi Host protocol and a feature-detected preload bridge, so that unsupported hosts fail closed rather than breaking the renderer.
29. As an AgentStudio maintainer, I want package mutation to invalidate stale Pi session runtimes, so that the next run cannot reuse a resource loader created before installation or removal.
30. As an AgentStudio maintainer, I want package skills to retain existing snapshot size, file-count, and symlink boundaries, so that package origin does not bypass Skill Resource View safeguards.
31. As an AgentStudio maintainer, I want custom package tools to retain source/version provenance in the active-tool contract, so that collisions and audits can be resolved deterministically.
32. As an AgentStudio maintainer, I want builtin tool overrides rejected by default, so that a third-party package cannot silently replace a security-sensitive Host capability.
33. As an AgentStudio maintainer, I want catalog discovery decoupled from package installation authority, so that a pi.dev presentation change cannot corrupt installed package state.
34. As an AgentStudio maintainer, I want npm registry metadata to be the machine-readable v1 discovery source and pi.dev to remain a detail link, so that the feature does not depend on undocumented HTML structure.
35. As an AgentStudio maintainer, I want v1 limited to pinned npm user-scope packages, so that git authentication, local paths, project trust, and automatic updates do not inflate the first implementation.
36. As a release reviewer, I want one high-level lifecycle qualification to prove install, discovery, shared use, and removal, so that the feature is tested at the same Host seam users exercise.
37. As a release reviewer, I want mutation during an active run to fail closed, so that the most important lifecycle race has direct regression evidence.
38. As a product owner, I want the UI to say "compatible resources" rather than "all Pi Packages work," so that product claims match actual AgentStudio support.

## Implementation Decisions

- **唯一 package authority 是 Pi Core Host。** Renderer 只投影查詢結果並發出使用者操作意圖；package settings、installed state、resource discovery、trust state 與 runtime invalidation 都由 Host 決定。
- **復用 Pi 原生 package lifecycle。** 安裝、移除、列舉與資源解析直接委派給 vendored Pi package manager、settings manager 與 resource loader。不得 shell out 到 Pi CLI，也不得在既有 MCP plugin installer 中複製一條 Pi package 分支。
- **v1 source contract。** 只接受 `npm:<name>@<exact-version>`，只寫 user scope。UI 或 Host 必須拒絕 unpinned npm source、git、URL、local path 與 project-local request。
- **Catalog 與安裝分離。** npm registry 的 `pi-package` metadata 作為 v1 可機器讀取的探索來源；pi.dev、npm 與 repository 是外部詳情連結。Catalog 結果不構成 installed truth，且不使用 iframe 或 undocumented HTML scraping。
- **完整信任而非 sandbox。** 安裝前必須顯示 package 與 npm lifecycle scripts 可能執行任意本機程式碼；extension 可能取得 filesystem、process、network、environment 與 credential authority。確認結果是 trust evidence，不得以「受限執行」或「安全套件」描述。
- **Idle-only mutation。** Package install/remove 只在沒有受影響 active Pi run 時執行。若有 active run，Host 以可辨識原因拒絕；不排隊偷偷套用，也不在 turn 中熱載入或卸載 extension。
- **Mutation 後 runtime generation 前進。** 成功安裝或移除後，既有 session runtime 標記失效並安全釋放；下一個 Agent Chat 或 Pi-backed SubDesign run 重新建立 resource loader。失敗操作不得前進 generation 或宣告 installed。
- **Skills 經 frozen resource view。** Package manager/resource loader 解析出的 skill resources 由 Host 投影進每輪 immutable Skill Resource View，保留既有來源、digest、容量、檔案數與 symlink fail-closed 邊界。Renderer 不直接掃 package skills，也不複製成第二份 skill catalog。
- **Extension tools 採兩階段 admission。** Installed 不等於 active。只有使用者明確信任並啟用 package 後，其相容工具才可加入 active-tool set；每輪仍由 Host-issued tool contract 決定 model-visible schema 與執行資格。
- **Package provenance 是 contract facts。** Package tool／skill identity 至少包含 package name、exact version 與 resource origin，並進入可查核的 runtime evidence。Package tool 不得無 provenance 地降級為一般 extension-pack。
- **既有安全政策不因 package 弱化。** Approval、Outbound Data Gate、Turn Record、execution evidence 與 settlement 規則維持原 authority。Extension 內部任意程式碼無法被 tool approval 完整 sandbox，因此 trust 警告是必要而非替代既有政策。
- **Builtin override 預設禁止。** v1 不允許 package 靜默註冊與安全敏感 builtin 同名的 active tool；collision 回報為不可啟用 diagnostics，不建立自動改名或兼容層。
- **共享使用是同一 runtime projection。** Agent Chat 與 SubDesign 不各自安裝或同步 packages。凡透過 canonical Pi-backed run lifecycle 執行者，都從同一 Host package state 建立資源；非 Pi-backed runner 不宣稱支援。
- **相容性以資源類型為準。** v1 支援 package skills 與符合 Host tool contract 的 extension tools。Lifecycle hooks 只在 package 通過明確信任且不破壞 Host lifecycle 時視為 extension 的一部分；themes、TUI custom UI、prompt templates、slash commands 與 provider extensions 不標示為可用。
- **Settings 頁面維持 domain 區隔。** 「Pi Packages」可與既有 Pi Core settings 相鄰，但 UI 文案清楚區分 Pi-native package resources 與 curated connector/MCP integrations；不建立共用但語意模糊的 installed flag。
- **最小 protocol surface。** Host package domain 只需提供 list、inspect、install、remove 與有界進度／diagnostics；不在 v1 暴露 update、project scope、package-manager selection 或任意 shell arguments。
- **交付順序。** 先完成 Host lifecycle 與 reload，再接 frozen skills，再接 trusted extension-tool admission，最後接 Settings catalog／管理 UI。每一階段都建立在同一 Host authority 上，不以暫時 renderer 實作搶跑。

## Testing Decisions

- **只採一個最高層 lifecycle seam。** 使用現有 Host protocol／runtime qualification 方式，從 package install request 開始，觀察 persisted installed state、runtime generation、resource discovery、Agent Chat 與 Pi-backed SubDesign 的可見性，最後 remove 並確認下一輪資源消失。測試外部可觀察 contract，不測 npm command argument、內部 helper 或 renderer component state。
- **主路徑只有一個 fixture。** 使用一個受控 package fixture，包含一個 skill 與一個無 builtin collision 的 extension tool。主路徑驗證 pinned install → list/inspect → safe reload → Chat/SubDesign discovery → trusted tool active contract → remove → 下一輪不可見。
- **關鍵失敗路徑只有一個。** 在 active Pi run 期間提出 install 或 remove，斷言 Host fail-closed、installed state 與 runtime generation 不變。其他 npm、網路、catalog 與 UI 邊界不建立矩陣式新增測試。
- **沿用既有 qualification 基礎。** 新驗證沿用專案既有 Host protocol、Pi runtime 與 smoke fixture 模式並掛入現有 gate；不新增測試框架、browser E2E 基礎設施或大量 snapshot。
- **既有測試能證明者不重測。** Approval、Outbound Data Gate、Turn Record 與 frozen skill bounds 只需確認 package path 經過既有 seam；除非本次行為改動使既有 smoke 無法發現回歸，否則不複製其完整測試。

## Out of Scope

- Pi themes 映射為 AgentStudio React themes。
- Pi TUI custom UI、terminal widgets 或其他 TUI-only extension surfaces。
- Pi prompt templates 與 extension slash commands 接入 AgentStudio composer／slash registry。
- Dynamic provider extensions 與 model settings/catalog projection。
- Git、URL、SSH、local path 或 project-local package sources。
- Project trust、team-shared package settings 與 repository checkout 自動安裝。
- Unpinned npm versions、`latest`、自動更新、背景更新或 dependency update policy。
- 使用 iframe 內嵌 pi.dev，或抓取 pi.dev HTML 作為正式 catalog API。
- 把現有 curated connector/MCP marketplace 改造成通用 Pi package manager。
- Extension sandbox、npm lifecycle sandbox 或「已審核安全」package certification。
- Builtin tool override、自動 tool rename 或 collision compatibility layer。
- 非 Pi-backed external CLI runner 的 package resource injection。
- 為未支援資源建立 React adapter、第二套 prompt registry 或第二套 theme runtime。

## Further Notes

- 可行性結論是 **Go with scoped compatibility**：一鍵安裝本身可直接復用 Pi Core 能力，但「安裝成功」與「AgentStudio 可使用所有資源」是不同狀態。產品應展示 installed、compatible、trusted、active 與 diagnostics，而不是單一模糊成功標記。
- Pi Packages 是 Trusted Extension／Skill delivery mechanism，不是受限 App Store。即使 extension tools 仍受 Host tool contract 管理，npm lifecycle scripts、extension initialization 與 hooks 仍可能在工具呼叫之外執行程式碼，使用者必須先信任來源。
- `pi.dev/packages` 目前適合作為 discovery/detail experience，但未驗證有穩定公開 JSON contract。若未來官方提供 catalog API，只替換 discovery adapter；Host package lifecycle 與 installed truth 不需改變。
- v1 完成定義：使用者能從 Settings 找到一個 pinned npm Pi Package、看到完整風險、明確確認後安裝，在下一個 Agent Chat 與 Pi-backed SubDesign run 使用其相容 skill／trusted tool，並能移除；任何不相容資源均如實標示而非靜默宣稱成功。
