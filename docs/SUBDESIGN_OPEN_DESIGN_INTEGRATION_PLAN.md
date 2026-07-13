# SubDesign × Open Design 整合功能計劃書

> 狀態：規劃完成，SubDesign Foundation 入口已建立；尚未開始導入完整的 preview / export runtime。  
> 分析來源：`nexu-io/open-design`，本次分析 commit `4567a0d57557b29eb79ef1f7a40826f2b801d982`（2026-07-11）。  
> 授權提醒：Open Design 為 Apache-2.0；若未來複製其程式碼、模板或資產，必須保留原始授權與 NOTICE。此計劃優先採用「概念與資料契約」整合，不直接 vendoring 上游 monorepo。

## 1. 結論與產品定位

SubDesign 應是 SubAgents AI 中的「設計任務模式」，不是第二套獨立 Open Design App。

它沿用既有能力：

- Electron 本機專案與 IPC 橋接。
- Build / Plan agent、`ask_user`、`update_plan`、HITL、Diff、thread replay。
- Skills、MCP、plugin、OpenCode/CLI provider、project root 與 CodeGraph。
- 本機優先的檔案寫入與權限模型。

它新增設計專屬的資料契約與操作表面：

1. **Design brief**：目標、受眾、品牌、平台、artifact 類型、品質門檻。
2. **Design system**：可解析的 `DESIGN.md`、tokens、資產、元件 reference。
3. **Artifact**：HTML prototype、dashboard、deck、SVG、文件等的 manifest、preview、版本與 export。
4. **Design loop**：Brief → Direction → Build → Critique → Deliver。

第一階段不應執行的事：搬入 Open Design 的 Next.js UI、Express daemon、SQLite、22 個 CLI adapter、媒體模型 router、PPTX/MP4 pipeline。這些功能規模大且和現有 engine / Electron bridge 重疊，直接導入會造成兩套執行生命週期、設定與安全政策並存。

## 2. Open Design 原始碼架構分析

### 2.1 Monorepo 與執行進程

Open Design 是 pnpm workspace（Node ~24、pnpm 10），根目錄把 product 切為下列邊界：

| 區塊 | 主要位置 | 責任 | 關鍵套件 |
|---|---|---|---|
| Desktop shell | `apps/desktop` | Electron 啟動、preload、sidecar、檔案開啟、PDF/export bridge、更新 | Electron 41、workspace host/sidecar packages |
| Local daemon | `apps/daemon` | HTTP API、agent spawn、stream parser、artifact/project/skill/plugin store、MCP、export | Express 5、node-pty、better-sqlite3、MCP SDK、PPTXGenJS、pdf-lib |
| Web UI | `apps/web` | Next 16/React 18 UI、composer、project workspace、iframe preview、設計系統與 plugin surface | Next、React、Lexical、xterm、Shiki、motion |
| Shared contracts | `packages/contracts` | 前後端資料模型、Zod contract、SSE/HTTP schema、artifact / plugin / design system contract | Zod |
| Plugin runtime | `packages/plugin-runtime` | 無 Node I/O 的 manifest parser、adapter、merge、validation、digest | Zod、contracts |
| Platform/host/sidecar | `packages/platform`、`host`、`sidecar*` | process、桌面 host、daemon/desktop IPC 協定 | workspace packages |

`apps/daemon/src/cli.ts` 是 `od` CLI router。一般執行會啟動 daemon；`od media`、`od mcp`、`od plugin`、`od project`、`od artifacts` 等 subcommand 則作為本機 HTTP daemon 的 thin client。`daemon-startup.ts` 預設只綁定 `127.0.0.1:7456`，並提供可控 shutdown。

### 2.2 Agent adapter 層

Open Design 沒有自行實作 LLM agent；它把使用者電腦上已安裝的 coding-agent CLI 視為 design engine。

`apps/daemon/src/runtimes/registry.ts` 聚合 Claude、Codex、OpenCode、Cursor、Copilot、Hermes、Qwen 等 adapter。每個 `RuntimeAgentDef` 定義：

- binary 名稱、version/auth probe、fallback/live model list。
- model/reasoning 參數與 `buildArgs()`。
- prompt 傳遞方式（argv、stdin、prompt file）。
- stdout 的 stream format / parser。
- image path、MCP 注入、CLI session resume、inactivity timeout 等 capability。

以 Codex adapter（`runtimes/defs/codex.ts`）為例：它選擇 `codex exec --json`，以 stdin 傳 prompt、解析 JSON event stream、擷取 upstream thread id 以支援 follow-up resume，並根據平台決定 workspace-write / danger-full-access sandbox 參數。

這和本專案現況高度相容：`agent/runDispatch.ts` 已支援 builtin engine 與 Codex/Claude/Grok/OpenCode/Cursor local CLI；`localCliRun.ts` 已蒐集 stream、保存 task list。**SubDesign 不需要建立第二個 adapter registry**，應擴充既有 CLI runner 的 design prompt、artifact 偵測與結果保存。

### 2.3 設計資產的檔案模型

Open Design 的可複用價值主要是「全部設計知識以本機檔案存在」，而非 UI 本身：

| 資產 | 上游位置 | 格式 | 行為 |
|---|---|---|---|
| Skills | `skills/*/SKILL.md` | Markdown + YAML frontmatter | 列表掃描、user root 優先覆蓋 built-in、依 mode/surface/platform 注入 prompt |
| Design systems | `design-systems/*/DESIGN.md` | `DESIGN.md`，可附 `manifest.json`、`tokens.css`、preview/assets | 掃描、擷取 title/category/swatches，作為 agent 品牌約束 |
| Brand | `brands/*` 及 `brands/design-md.ts` | 結構化 Brand 轉為 `DESIGN.md` | 將色彩、字體、語氣、意象、版型轉成可注入契約 |
| Templates | `design-templates/`、`prompt-templates/` | HTML/媒體 prompt/資產 | 作為可信 seed/reference，而非每次從零生成 |
| Plugins | `plugins/*` + plugin runtime | manifest + stages / atoms | 安裝、snapshot、輸入驗證、pipeline、capability gate |

設計系統 registry（`design-systems/index.ts`）支援 legacy `DESIGN.md` 與 manifest project。它讀取 H1、category、frontmatter `colors` 或 Markdown swatch table，形成可挑選的 `DesignSystemSummary`。`brands/design-md.ts` 證明了重要模式：品牌的資料不是只存在 UI state，而是可生成一份可讀、可 version control、可給 agent 使用的 `DESIGN.md`。

### 2.4 Prompt composition 與設計迴圈

`apps/daemon/src/prompts/system.ts` 的 prompt 組裝由多層構成：

1. 安全防 prompt injection 的根指令。
2. 設計師 identity 與 discovery / direction / critique 原則。
3. 選定 design system 的 `DESIGN.md`。
4. 選定 skill 的 `SKILL.md`，以及 seed/template/reference pre-flight。
5. artifact 類型專屬契約（例如 deck 的 navigation / print/export 規則）。
6. 專案、附件、連接器、MCP、使用者訊息與本回合 context。

README 描述的使用者迴圈是：**discover brief → lock direction → stream artifact → critique → deliver**。這正好可映射到本專案已完成的 `ask_user`、`update_plan`、Run process feed、Diff、subagent tree。差異在於目前本專案的 prompt 偏「通用任務」，還沒有「設計方向選擇、品牌契約與 artifact 驗收」的專用 capability。

### 2.5 Project、artifact、preview 與 export

Open Design 將一個設計工作單位記錄為 Project（`packages/contracts/src/api/projects.ts`）：

- `kind`: prototype / deck / brand / image / video / audio / other。
- `metadata`: platform、fidelity、template、linked folders、design system、media settings、plugin/context 等。
- Conversation / run status / messages 綁在 project 下。

Artifact manifest（`apps/daemon/src/artifacts/manifest.ts`）則把輸出明確化：

- kind: html、deck、react-component、markdown-document、svg、diagram、mini-app、design-system。
- renderer: html、deck-html、markdown、svg、code、mini-app、design-system。
- export: html、pdf、zip、jsx、md、svg、txt。
- entry / supporting files 一律 project-relative，拒絕 absolute path、NUL、`..` traversal。

Web UI 以 sandboxed iframe 預覽 HTML artifact；deck、Markdown、SVG 走對應 renderer；daemon 負責 HTML/PDF/PPTX/ZIP 等 export。這個 manifest-first 策略是 SubDesign 最值得採用的部分，因為它將「模型回覆中的檔案」轉換為可驗收的產品輸出。

### 2.6 Critique 與可中斷執行

上游有完整 critique 子系統（`apps/daemon/src/critique/`）：run registry、orchestrator、scoreboard、transcript、persistence、ratchet、interrupt handler。它以 policy/rollout 控制是否啟用，讓設計產物可以接受多回合評分與修正。

本專案已有 Goal-based DoD、Safety/HITL、delegate isolation、subagent tree、run summary。SubDesign 第一版應採「輕量 critique」：同一 agent 或隔離 `@explore` 角色檢查對照 brief / DESIGN.md / accessibility checklist，輸出結構化 verdict；不要在早期引入獨立多 panelist orchestrator。

## 3. 與現有 SubAgents AI 的差異與整合判斷

| Open Design 元件 | 本專案現有對應 | SubDesign 方針 |
|---|---|---|
| Electron desktop shell | `app/electron/*` | 重用，不另建 desktop app |
| Express local daemon | Electron IPC + renderer engine | 早期不導入；後期只有需要獨立 preview/export queue 時才抽 sidecar |
| CLI adapter registry | `agent/localCliRun.ts`、`agent/runDispatch.ts`、CLI settings | 擴充現有 runner prompt / stream artifact parser |
| Skills `SKILL.md` | `agent/hermes/skills.ts` | 重用；新增 `subdesign-*` skills |
| `DESIGN.md` | project context / workspace tools | 新增 design-system capability 與 scanner |
| Project model | `threadStore` + projectStore | 不取代 thread；以 Thread 關聯 `SubDesignSession` |
| Artifact manifest | 目前只有 files / run summary / Diff | 新增可驗證 `SubDesignArtifact` manifest |
| iframe preview | 尚無專屬 renderer | 以 sandboxed BrowserView/iframe 分期導入 |
| PDF/PPTX/MP4 export | 報告輸出與 Electron 既有 shell | HTML/ZIP first；PDF/PPTX/MP4 按需求加入 |
| Critique theater | DoD、delegates、Run panel | 先做 structured critique capability |

## 4. 已完成：SubDesign Foundation

已建立：

- 左側「執行」群組中，**SubDesign** 位於「新任務」下方。
- `/subdesign` 頁面提供 prototype、dashboard、design system、deck 四種設計任務入口。
- 使用者填 brief 後，新建 `SubDesign · <surface>` Plan thread，將流程 prompt 放入既有 composer。
- 這個 prompt 明確要求使用 `ask_user`、`update_plan`、先選 direction、讀取既有 `DESIGN.md`、最後交付 Diff 與驗證結果。
- 現階段不宣稱已具備 iframe preview 或 PDF/PPTX/MP4 export，UI 會揭露後續邊界。

相關檔案：

- `app/src/pages/SubDesignPage.tsx`
- `app/src/App.tsx`
- `app/src/components/Layout.tsx`

## 5. 目標架構

```text
SubDesign Page / Composer
  └─ SubDesignSession (threadId, brief, designSystemId, stage)
       ├─ design capability runbook
       ├─ update_plan / ask_user / HITL / delegate
       ├─ workspace read/write + git Diff
       ├─ DesignSystemStore ─── DESIGN.md / tokens / assets
       ├─ ArtifactStore ─────── manifest + files + revisions
       ├─ Preview bridge ────── sandboxed HTML / deck / SVG renderer
       └─ Export bridge ─────── HTML/ZIP → PDF → PPTX/MP4 (optional)
```

### 5.1 建議資料模型

```ts
type SubDesignStage = 'brief' | 'direction' | 'build' | 'critique' | 'deliver'

type SubDesignBrief = {
  id: string
  threadId: string
  surface: 'prototype' | 'dashboard' | 'design-system' | 'deck'
  objective: string
  audience?: string
  platform?: 'responsive' | 'web-desktop' | 'mobile-ios' | 'desktop-app'
  fidelity?: 'wireframe' | 'high-fidelity'
  designSystemId?: string
  constraints: string[]
  acceptanceCriteria: string[]
  stage: SubDesignStage
  createdAt: string
  updatedAt: string
}

type SubDesignArtifact = {
  id: string
  briefId: string
  kind: 'html' | 'deck' | 'react-component' | 'markdown-document' | 'svg' | 'design-system'
  title: string
  entry: string                 // project-relative only
  renderer: 'html' | 'deck-html' | 'markdown' | 'svg' | 'code' | 'design-system'
  exports: Array<'html' | 'pdf' | 'zip' | 'jsx' | 'md' | 'svg' | 'txt'>
  supportingFiles: string[]
  designSystemId?: string
  status: 'streaming' | 'complete' | 'error'
  revision: number
  createdAt: string
  updatedAt: string
}

type SubDesignCritique = {
  artifactId: string
  briefCoverage: number
  brandConformance: number
  accessibility: number
  implementationReadiness: number
  findings: Array<{ severity: 'blocker' | 'warning' | 'note'; message: string; path?: string }>
  verdict: 'pass' | 'needs-revision'
}
```

儲存位置建議為 `<projectRoot>/.subagents/subdesign/`：`briefs/*.json`、`artifacts/<id>/manifest.json`、`design-systems/<id>/`。如此不污染產品 source root，仍可被 Git 追蹤（由使用者選擇是否忽略）。thread 僅保存 reference / summary，以避免 localStorage 膨脹。

### 5.2 Design System 最小檔案契約

```text
.subagents/subdesign/design-systems/<id>/
  DESIGN.md                 # 必要：設計與品牌規則
  tokens.css                # optional：CSS custom properties
  design-tokens.json        # optional：machine-readable token map
  components.md             # optional：元件 API / states
  assets/                   # optional：logo、font、image
  manifest.json             # optional：metadata / preview entry
```

`DESIGN.md` 第一版固定 9 節：Overview、Audience、Color、Typography、Spacing/Layout、Components、Motion、Content voice、Do/Don't。這是對上游可讀性最高的精簡投影，不必一次複製其全部 design system library。

## 6. 分期實作計劃

### Phase 0 — Foundation（已完成）

**目標**：讓設計任務可以從產品入口產生，並由既有 agent loop 安全處理。

- [x] 新任務下新增 SubDesign navigation item。
- [x] Surface 選擇與 brief 輸入。
- [x] 建立 Plan thread 並 seed SubDesign workflow prompt。
- [x] 明示目前能力與未來 renderer/export 邊界。

**驗收**：選擇 surface、輸入 brief、按「開始」後回新任務，能看到新 thread 與設計工作流草稿，不會自動寫檔或跳過使用者確認。

### Phase 1 — Brief 與設計能力包

**目標**：把 SubDesign 提示升級為可保存、可恢復的結構化設計流程。

新增檔案：

- `app/src/agent/subdesign/types.ts`
- `app/src/agent/subdesign/brief.ts`
- `app/src/agent/subdesign/prompt.ts`
- `app/src/store/subDesignStore.ts`
- `app/src/agent/capabilities/subDesign.ts`

工作項目：

1. 將 brief 存成 `SubDesignBrief`；thread 保存 `subDesignBriefId`。
2. 新增 always-on / deferred capability：`subdesign-workflow`。
3. Runbook 強制每個 stage 的輸出格式：direction 的比較表、build 的 artifact declaration、critique 的 verdict。
4. 新增 `design_brief_update`、`design_direction_select` 的內部工具；皆是本機 metadata，不需 HITL。
5. 將 `update_plan` 與 stage 同步，避免 agent 宣稱完成但 plan 未更新。
6. `ask_user` 的選項支援 direction cards（最多 3 個、可 freeform）。

**驗收**：中斷後重新開啟 thread，brief、選定 direction、stage、任務計畫能回放；沒有選 direction 時，Build stage 不可進行 workspace write。

### Phase 2 — Design System Registry

**目標**：令 agent 與 UI 共同使用可版本化的品牌規則。

新增能力：

- scanner：掃描 `.subagents/subdesign/design-systems/*/DESIGN.md` 與可選 project root `DESIGN.md`。
- parser：讀 YAML frontmatter / H1 / Color table；生成 summary、swatches、token paths。
- UI：SubDesign page / composer 可選 design system，預覽 palette / typography summary。
- tools：`design_system_list`、`design_system_read`、`design_system_create`、`design_system_update`。

安全規則：

- `list/read` 是唯讀；`create/update` 視為 `workspace_write`，沿用 Build mode + HITL。
- 所有 file path 經現有 `resolveWorkspacePath`，不得接受 absolute path 或 traversal。
- 外部 URL 品牌抓取延後至明確的 `http_fetch` approval flow；不在 parser 自動發網路請求。

**驗收**：選定 system 後，其 `DESIGN.md` 摘要會出現在 run prompt 與 run summary；Plan mode 只能讀不能改；Build 寫入時出現既有核准 UI。

### Phase 3 — Artifact Manifest 與 Sandbox Preview

**目標**：讓設計輸出成為可見、可驗證、可版本化的 artifact，而不是只有聊天文字。

新增檔案：

- `app/src/agent/subdesign/artifactManifest.ts`（純 TS validation）
- `app/src/store/subDesignArtifactStore.ts`
- `app/src/components/subdesign/ArtifactRail.tsx`
- `app/src/components/subdesign/ArtifactPreview.tsx`
- Electron `subdesign:listArtifacts` / `readArtifact` IPC。

實作：

1. 模型透過 `design_artifact_register` 登記 manifest，或由 engine 在偵測到 `artifact-manifest.json` 時驗證。
2. manifest 限制 kind / renderer / export enum，`entry`、supporting files 必須 project-relative。
3. HTML preview 使用 `<iframe sandbox="allow-scripts">`，不給 `allow-same-origin`；以 Blob URL 或受控 IPC content server 載入。
4. Preview 前注入 CSP，禁止 artifact 任意連線本機 IPC/daemon；network 預設 `connect-src 'none'`。
5. 記錄 artifact revision / hash；Diff 與 artifact revision 關聯。
6. renderer 初期支援 HTML、Markdown、SVG；deck 先按 HTML preview，React component 先顯示 code view。

**驗收**：惡意 HTML 無法讀取 Electron preload、父頁 DOM 或本機檔案；invalid manifest / traversal 被拒絕；同一 artifact 可在 thread summary 中開啟歷史 preview。

### Phase 4 — Critique 與 Direction Gate

**目標**：將「好看」轉為可審查的完成條件。

工作項目：

1. `design_critique` capability：讀 brief、DESIGN.md、artifact manifest、可選 screenshot。
2. 第一版採用隔離 leaf delegate：只讀 artifact + brief，不能寫檔、不能 delegate。
3. 輸出 `SubDesignCritique`：brief coverage、brand、a11y、readiness 分數與 finding。
4. 為 `blocker` 建立修正 plan；只有 verdict pass 或使用者明示略過才到 Deliver。
5. Render screenshot 的話，使用 Electron offscreen/BrowserView，而非把 renderer 放進 Node worker。

**驗收**：critique finding 可連到 artifact path；critique 不具寫權；pass/needs-revision 會影響 stage 與 final answer。

### Phase 5 — Export 與交接

**目標**：先小後大地加入交付格式。

| 優先度 | Export | 實作建議 | 依賴 |
|---|---|---|---|
| P0 | HTML source / ZIP | 現有 workspace read + archive IPC | 盡量使用 Node `archiver` 或既有 JSZip |
| P1 | PDF | Electron `webContents.printToPDF()`，避免引入 browser daemon | 無新增 native dependency |
| P2 | PPTX | artifact 要求明確 slide schema 後才用 `pptxgenjs` | `pptxgenjs` |
| P3 | MP4 | 等 HyperFrame / video composition 資料模型已驗證再做 | Playwright/Chrome + FFmpeg，外部 binary |

每一種 export 都必須：

- 顯示檔名與來源 artifact revision。
- 出現 HITL（會產生檔案）。
- 對 export 產生 hash / metadata，回寫 thread summary。
- 不允許輸出 path 離開 project 或使用者選擇的 destination。

### Phase 6 — 相容性與外掛

**目標**：讓現有 Hermes skills、MCP 與 plugin marketplace 能提供設計能力。

- 將 `subdesign-skill` 規格映射到現有 SKILL.md loader，新增 frontmatter：`subdesign.surface`、`artifactKinds`、`requiresDesignSystem`。
- 將 `subdesign-template` 定義為可檢閱的 custom tool package / plugin，而非讓未審核模板直接寫檔。
- 視需求支援匯入 Open Design `SKILL.md` / `DESIGN.md`：只讀 preview → 顯示 license/source → 使用者確認後 copy 到 project。
- 不直接執行上游 plugin pipeline；先將 manifest 映射為現有 plugin registry 的 reviewed package。

## 7. 需要新增或可延後的套件

### 7.1 首期（Phase 0–2）

**不需要新增 runtime dependency。**

原因：目前 React、Zustand、Electron IPC、workspace tools、skills、Diff、HITL 已足以建立 brief / design system registry。Markdown/frontmatter parser 可使用現有簡單 parser，或以 project 既有依賴為優先。

### 7.2 Preview / export 階段再評估

| 需求 | 候選 | 決策條件 |
|---|---|---|
| HTML sanitize | DOMPurify（renderer）或嚴格 iframe sandbox + CSP | 必須有測試證明不能取得 preload/parent origin |
| ZIP | `archiver` 或 JSZip | 只在要產生 zip 時加入；嚴格限檔案數與大小 |
| PDF | Electron 原生 `printToPDF` | 優先，不需再包 Chromium |
| PPTX | `pptxgenjs` | 必須先有 slide/layout schema，否則只是在把 HTML 硬轉 PPTX |
| Image transform | `sharp` | 只有需要縮圖/asset optimization 才引入，注意 native build |
| MP4 | FFmpeg / HyperFrames-like runtime | 僅在明確產品需求、sandbox 與 binary distribution 策略完成後 |

**禁止早期加入**：Open Design 的 `better-sqlite3`、`node-pty`、Express/Next、完整 20+ adapter、PostHog、FFmpeg。它們在 SubAgents AI 已有替代或會引入高維運成本。

## 8. 安全、隱私與權限

1. **Preview isolation**：HTML artifact 不可信，必須 iframe sandbox + CSP；不能載入 Electron preload、`file://`、內網、父頁 origin。
2. **Path safety**：artifact manifest 不接受 absolute path、`..`、NUL；所有讀寫走 Electron main 的 containment resolver。
3. **Capability gate**：Plan mode 可 brief/design-system read/critique；Build mode 才可 create/update artifact / export。
4. **HITL**：設計檔寫入、asset import、export、remote brand fetch 一律由既有 permission modal 處理。
5. **Prompt injection**：外部網站、Figma/設計檔、template 都是 data；SubDesign prompt 要延續現有 runbook 的 untrusted content 規則。
6. **Provenance**：imported skill/template/design system 必須保存 source URL、license、檔案 hash、import time。
7. **資源限制**：preview / screenshot / export 限制輸出大小、timeout、concurrency；不可卡住全域 single run mutex。

## 9. 測試計劃

| 層級 | 測試 |
|---|---|
| Pure TS | brief stage transition、manifest enum/path validation、DESIGN.md parser、token extraction、prompt composition |
| Electron contract | `subdesign:*` IPC path containment、preview server token、export destination validation |
| UI | Surface selection、建立 thread、draft seed、stage indicator、artifact rail 空/錯誤/完成狀態 |
| Security | iframe 不能存取 parent/preload、manifest traversal/absolute path 被拒、untrusted HTML 無網路能力 |
| E2E | brief → direction ask → build 寫 artifact → register manifest → preview → critique → export HTML/ZIP |
| Regression | `npm run build`、`npm run smoke`、`npx oxlint src`、`git diff --check` |

## 10. 實作順序與完成定義

1. **Foundation**（完成）：入口與安全的 prompt seed。
2. **Brief / stage persistence**：使用者可中斷與恢復，不遺失 direction。
3. **Design system registry**：設計規則可選、可讀、可審核寫入。
4. **Artifact manifest + preview**：具體檔案可預覽、可回放、可 Diff。
5. **Critique**：交付前有結構化設計驗收。
6. **HTML/ZIP/PDF export**：確保基本交接閉環。
7. **PPTX / media / Open Design import compatibility**：只在前述閉環穩定後。

最小可用版本（MVP）的 Definition of Done：

- 使用者可從 SubDesign 建立 prototype/dashboard/design-system/deck brief。
- agent 必須先取得 direction，再在 Build mode 寫入 artifact。
- 每一 artifact 有安全 manifest、sandboxed preview、歷史 revision 與 Diff。
- design system 能以 `DESIGN.md` 約束生成結果。
- critique 可阻擋不符合 brief/brand/a11y 的交付。
- HTML/ZIP 可 export，整個流程受到既有 HITL 與專案路徑限制。

## 11. 上游原始碼閱讀索引

| 主題 | Open Design source |
|---|---|
| workspace / dependency matrix | `package.json`、`pnpm-workspace.yaml`、`apps/{desktop,daemon,web}/package.json` |
| daemon lifecycle | `apps/daemon/src/cli.ts`、`daemon-startup.ts`、`server.ts` |
| adapters | `apps/daemon/src/runtimes/{types,registry,detection,launch}.ts`、`defs/codex.ts` |
| skills | `apps/daemon/src/skills.ts` |
| prompt layers | `apps/daemon/src/prompts/system.ts`、`discovery.ts`、`official-system.ts` |
| design systems / brands | `apps/daemon/src/design-systems/index.ts`、`brands/design-md.ts` |
| artifact contract | `apps/daemon/src/artifacts/manifest.ts`、`packages/contracts/src/api/artifacts.ts` |
| project contract | `packages/contracts/src/api/projects.ts` |
| plugin boundary | `packages/plugin-runtime/*`、`packages/contracts/src/plugins/*` |
| UI surfaces | `apps/web/src/components/{EntryShell,HomeView,ChatComposer,ProjectView,DesignSystem*}.tsx` |
| critique | `apps/daemon/src/critique/*`、`apps/web/src/components/Theater/*` |

