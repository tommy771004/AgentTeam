# Open Design harness 與 AgentTeam 整合研究

> 調查日期：2026-08-20  
> 「近三個月」門檻：GitHub `pushed_at >= 2026-05-20`。`updated_at` 可能只因 issue 或星數變動，因此不作為活躍度判準。

## 結論

[Open Design](https://github.com/nexu-io/open-design) 不是單純的 prompt、模板或前端編輯器。它是一個 local-first、contract-driven 的 agent harness，將多種 CLI agent、plugin pipeline、能力授權、對話式 GenUI、artifact renderer、run lifecycle、handoff 與 memory 統一到 daemon 後面。

AgentTeam 已經有相似且更符合本產品安全模型的骨架：Pi Core、`runTask` 單一入口、tool registry、SubDesign 五階段生命週期、Open Design catalog/pack，以及 artifact manifest/preview/export。因此不建議把 Open Design daemon 整套嵌入或另建第二個執行迴圈。正確做法是採用它的「協定與分層」，把外部能力接到既有 Pi Core 邊界。

優先順序：

1. P0：擴充既有 Open Design plugin manifest，加入版本、pipeline、capability grant、snapshot/lock 與 eval 欄位。
2. P0：以 Storybook MCP 提供真實元件、stories、controls 與文件語境。
3. P0：以 Chrome DevTools MCP 或既有 browser QA adapter 產出 console、network、performance 證據。
4. P1：以 Harness 補上 goal-based UX 測試與 friction evidence。
5. P1：試作 MCP Apps 的 sandboxed inline UI，承載方向選擇、表單與確認流程。
6. P2：OpenGenerativeUI 僅借用 streaming artifact contract；TypeUI 在授權釐清前只作外部參考。

## Open Design harness 分層

### 1. Runtime adapter plane

`apps/daemon/src/runtimes/` 用一份 `RuntimeAgentDef` 將 Claude、Codex、OpenCode、Cursor、Qwen、Pi 等 CLI 差異正規化，包括：

- executable/version detection
- argument 與環境變數組裝
- plain、JSON、JSONL/stream parser
- prompt 經 stdin、argument 或 file 傳遞
- session resume、MCP forwarding、plugin disable
- capability/version compatibility policy
- run restart reconciliation 與 terminal control

這是「多 CLI adapter registry」，不是讓每個 agent 各自擁有一套 UI 邏輯。

### 2. Run orchestration plane

daemon 維護 durable run 狀態、terminal status、事件摘要、tool/model-step metrics，以及程式重啟後的 interrupted reconciliation。Web/Electron UI 只是觀察與發出意圖，不直接擁有 runner lifecycle。

### 3. Plugin pipeline plane

一個 plugin 最少可只有 `SKILL.md`，也可帶 `open-design.json`。規格涵蓋：

- `od.kind`、`taskKind`、`mode`、inputs
- pipeline stages、atoms、`repeat`、`until`
- capability declarations
- GenUI surfaces 與 persistence scope
- import/create/export/share/deploy/refine/extend lanes
- evals、trigger queries、preview 與 marketplace metadata

pipeline runner 將純 scheduler 與實際 SSE/NDJSON event、GenUI cache、iteration 記錄和 stage worker 解耦。

### 4. Capability and trust plane

重要能力包括 `prompt:inject`、`fs:read`、`fs:write`、`mcp`、`subprocess`、`bash`、`network`、`connector`。授權是可記錄、可合併、可撤銷的 grant，而不是只因安裝 plugin 就獲得全部權限。

### 5. Artifact plane

Artifact 使用 versioned manifest 表示 kind、renderer、status、exports 等資訊，再由 renderer registry 選擇 HTML、deck、React、Markdown、SVG 等 renderer。streaming 支援是 renderer capability，不是每種 artifact 都假設可串流。

### 6. Experience and memory plane

Open Design 把 brief、plugin、direction、design system、artifact、handoff、memory 串成一條工作流；form、choice、confirmation、OAuth prompt 等 GenUI surface 可依 run、conversation 或 project 保存。

主要來源：

- [Open Design repository](https://github.com/nexu-io/open-design)
- [Plugin specification](https://github.com/nexu-io/open-design/blob/main/plugins/spec/SPEC.md)
- [Plugin implementation plan](https://github.com/nexu-io/open-design/blob/main/docs/plans/plugins-implementation.md)
- [Runtime type contract](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/runtimes/types.ts)
- [Runtime registry](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/runtimes/registry.ts)
- [Pipeline runner](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/plugins/pipeline-runner.ts)
- [Artifact manifest](https://github.com/nexu-io/open-design/blob/main/apps/web/src/artifacts/manifest.ts)
- [Renderer registry](https://github.com/nexu-io/open-design/blob/main/apps/web/src/artifacts/renderer-registry.ts)

## 與 AgentTeam 的對應

| Open Design | AgentTeam 現況 | 判斷 |
|---|---|---|
| daemon/run lifecycle | `agent/taskRunCoordinator.ts` 的 `runTask`、run registry、Pi Core utility process | 已有核心，不應建立第二個 coordinator |
| runtime adapters | builtin loop + external CLI capability matrix | 可借用 adapter metadata，但 external success 不能被誤判為 DoD met |
| plugin catalog/installer | `agent/openDesign/catalog.ts`、`packs.ts`、Electron vendor-pack copy | 已有分發入口，適合擴充 manifest subset |
| pipeline/stages | `agent/subdesign/workspace.ts` 五階段生命週期 | 應由既有 state machine 執行 plugin pipeline |
| capability grants | Pi Core approvals、tool registry、encrypted connector vault | 已有安全底座，需增加 plugin-level grant/lock 記錄 |
| artifact manifest | `agent/subdesign/artifactManifest.ts` | 高度相容，可擴充 evidence/provider/streaming capability |
| renderer registry | `components/subdesign/ArtifactPreview.tsx` 與 export/capture IPC | 可加 renderer adapter，但不能讓 renderer 直接存取 token 或網路 |
| GenUI surfaces | conversation pane、ask-user/方向選擇 UI | 可對齊 MCP Apps，但所有 tool call 仍由 host/Pi Core 代理 |
| memory/handoff | project context、run summary、artifact records | 可補 snapshot lock、resolved plugin version、evaluation evidence |

### 必須維持的整合限制

- 所有 run 仍經 `runTask`，UI 不可直接呼叫 `dispatchThreadTask` 或 `startExecution`。
- Pi Core 繼續擁有 tool loop、approval、execution 與 settlement。
- renderer 只接收結構化結果與 project-relative artifact，不讀 raw connector token。
- 外部 CLI/MCP 成功只代表工具成功，不等於 Goal-based DoD 達成。
- 安裝 plugin 不等於授予 `network`、`subprocess`、`fs:write` 或 connector 權限。
- 第三方產生的 HTML/UI 必須 sandbox、限制 origin/CSP，bridge payload 必須 schema validation。

## 近三個月可整合 GitHub 專案

下表日期為 2026-08-20 查得的 GitHub `pushed_at`。

| Repo | 最後推送 | 授權 | 適配度 | 建議用途 |
|---|---:|---|---|---|
| [modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) | 2026-08-12 | Apache-2.0（README/License；GitHub API 當時未辨識） | 高 | 在對話內呈現 sandboxed form、choice、canvas、dashboard，透過 host bridge 雙向呼叫工具 |
| [storybookjs/mcp](https://github.com/storybookjs/mcp) | 2026-08-20 | MIT | 高 | 將真實 stories、component metadata、docs、controls 注入 SubDesign context，降低生成不存在元件的機率 |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 2026-08-20 | Apache-2.0 | 高 | console/network/performance trace、DOM/DevTools 證據，接到 Critique evidence provider |
| [awizemann/harness](https://github.com/awizemann/harness) | 2026-07-21 | MIT | 高（macOS） | goal/persona UX 測試，輸出 success/failure/blocked、replay path、friction events |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 2026-08-19 | Apache-2.0 | 中 | accessibility-tree 驅動的確定性瀏覽；與現有 QA 重疊，先評估 CLI/skills 模式 |
| [CopilotKit/OpenGenerativeUI](https://github.com/CopilotKit/OpenGenerativeUI) | 2026-06-10 | MIT | 中 | 參考 streaming HTML/SVG tool contract、sandbox bridge、autosize；不引入 LangGraph 作第二 orchestration core |
| [bergside/typeui](https://github.com/bergside/typeui) | 2026-07-04 | 未明確 | 中低 | 設計系統、prompt、layout variation 的 MCP 來源；授權未明前不可 vendoring 或複製內容 |
| [hueyexe/frontend-agent-skills](https://github.com/hueyexe/frontend-agent-skills) | 2026-08-02 | MIT | 低／觀察 | 小型 accessibility、forms、composition skills；只有少量採用訊號，需逐份審核後選擇性匯入 |

### 候選分析

#### MCP Apps

它讓 MCP tool 宣告 `ui://` resource；host 在 sandboxed iframe 顯示 UI，並以 bridge 傳入 tool data 或代理後續 tool call。這很接近 Open Design 的 form/choice/confirmation GenUI surface，也能改善「執行中只有文字、沒有可操作回應」的問題。

建議先做 host-side spike，只允許固定 CSP、origin、tool allowlist 與 Zod/schema 驗證；不要把 MCP App iframe 當可信 renderer。

#### Storybook MCP

它可把元件文件、stories 與 component metadata 暴露給 agent。對 SubDesign 的直接價值是讓 brief/direction/generate 階段使用專案真實元件，而不是只憑截圖猜測。

風險：專案仍屬 experimental，且功能正往 Storybook monorepo/skills-first 方向遷移。應 pin version、feature flag、把回傳內容轉成內部 `ComponentEvidence`，不要讓產品型別直接依賴其未穩定 API。

相關追蹤：[skills-first issue](https://github.com/storybookjs/storybook/issues/35526)、[monorepo migration](https://github.com/storybookjs/storybook/issues/35553)、[shared toolsets](https://github.com/storybookjs/storybook/issues/35673)。

#### Chrome DevTools MCP

適合補齊視覺截圖之外的可驗證證據，包括 console error、network failure、layout/performance trace。應由 Pi Core tool adapter 執行，再將摘要與附件寫入 project-relative evidence manifest。

不建議 renderer 直接連 DevTools，也不應用 `@latest` 進 production；必須鎖版與限制可連線的 browser target。

#### Harness

Harness 的價值不是另一套像素比較，而是 goal-based user simulation。每次 run 產出 goal 結果、可重播步驟與 friction event，剛好可映射到 SubDesign Critique 階段。

它目前是 alpha、macOS 14+，自動操作也涉及 Screen Recording/Accessibility 權限。應先作 optional local provider，避免成為跨平台 release 的硬依賴。

#### Playwright MCP

成熟度與社群訊號強，但 AgentTeam 已有 Electron/browser QA 路徑。官方 README 也指出 MCP 不是 security boundary，且對 coding agent，CLI + skills 往往較省 token。初期可借用其 deterministic/accessibility-tree 做法，不必同時再引入一個長駐 MCP browser loop。

#### OpenGenerativeUI

可借用的核心是：ordered streaming parameters、activity event、sandboxed iframe、validated bridge、ResizeObserver autosize。其 Next.js/LangGraph/CopilotKit orchestration 不適合直接搬入 Electron + Pi Core 架構。

#### TypeUI 與 frontend-agent-skills

TypeUI 的 MCP 形式與設計知識方向有價值，但 repository 授權欄位未明確；只能先以外部 service/protocol spike 評估。`frontend-agent-skills` 為 MIT，但採用規模很小，適合當 watchlist，不適合直接成為官方 pack 的信任來源。

## 建議實作路線

### P0：plugin contract 與可靠證據

1. 在現有 `open-design.json` parser 增加可選的 `specVersion`、`capabilities`、`pipeline`、`evals`。
2. 安裝時產生 project-relative lock/snapshot，記錄 source、resolved commit/version、hash、grants。
3. 將 capability 映射到 Pi Core approvals；未授權時 fail closed。
4. 新增 `EvidenceProvider` 內部介面，先接現有 capture，再試接 Chrome DevTools。
5. 用 Storybook MCP 做唯讀 context provider，建立 timeout、size budget、cache 與 feature flag。

完成條件：plugin 不可繞過 `runTask`；每次 evidence/tool event 可在 run activity 看見；切換對話後能從 durable state 恢復。

### P1：UX lifecycle

1. 將 Harness session 封裝為 Pi Core tool，不讓它接管主 run。
2. 把 goal result、step JSONL、screenshots、friction events 正規化到 artifact/evidence manifest。
3. 讓 Critique stage 可選「靜態檢查」或「使用者目標測試」。
4. 試作 MCP Apps `choice`/`form` surface，先限定於方向選擇與確認，不開放任意 tool。

完成條件：Stop 能取消外部 session；settlement 必須區分 tool success、goal complete、blocked 與 cancelled。

### P2：streaming artifact 與生態

1. 定義內部 `StreamingArtifactEnvelope`，參考 OpenGenerativeUI，但維持現有 artifact manifest 為 source of truth。
2. 新 renderer 必須宣告 `supportsStreaming`、sandbox policy、export capability。
3. TypeUI 僅在授權與資料條款審查通過後進一步整合。
4. 定期重新評估 Storybook MCP 穩定 API 與 Playwright MCP 是否仍有缺口價值。

## 不建議的做法

- 不 fork Open Design 全套 daemon 進 AgentTeam。
- 不讓 SubDesign UI 直接 spawn CLI/MCP。
- 不因外部 command exit 0 就標記 DoD met。
- 不以遠端模板內容直接覆寫 project file。
- 不把第三方 HTML 放到 unsandboxed Electron renderer。
- 不在 production 使用未鎖定的 `@latest` MCP package。
- 不在授權不明時 vendoring TypeUI 內容。

## 建議下一個可交付項

先做一個小型 ADR/PR：**Open Design Plugin Contract v1 subset**。只改 catalog/parser、schema/validation、grant/lock persistence 與測試，不碰 UI。這會先建立安全且可版本化的整合底座，之後 Storybook、DevTools、Harness、MCP Apps 都能以 provider/plugin 方式接入，而不需反覆修改核心 lifecycle。
