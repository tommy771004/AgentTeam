# Open Design Plugin + Agent 整合計畫

> 狀態：分析與實作計畫；不在本文件範圍內直接啟用第三方 CLI、寫入使用者憑據，或放寬既有權限政策。  
> 分析日期：2026-07-13。  
> 上游目錄：[Plugins](https://open-design.ai/zh/plugins/) · [Agents](https://open-design.ai/zh/agents/) · source commit `4567a0d`。  
> 上游授權：Apache-2.0；vendored 模板另保留各自的 LICENSE／NOTICE。

## 1. 結論

SubAgents AI 已具備比 Open Design adapter shim 更深的執行核心：capability progressive disclosure、HITL、MCP、plugin package review、secret ownership、CLI 授權、thread resume 與 global queue。整合方向不應是移植 Open Design 的 desktop/daemon，而是建立兩條受治理的導入管線：

1. **Open Design plugin content** → 轉成可審核的本機 Template / Skill / Design System pack。
2. **Open Design agent adapters** → 擴充既有 `cliProviders` 與 `localCliRun`，統一由 `runDispatch`、權限門與 capability runtime 管理。

這樣可以取得上游「同一份 SKILL.md、DESIGN.md 可跨 agent 使用」的好處，同時保留本專案已經存在的安全與恢復機制。

## 2. 上游分析摘要

### 2.1 Plugin 目錄

上游將 plugin 生態描述為四類：Templates 與 Skills 為 agent 可執行內容，Systems 與 Craft 用於品牌一致性與可近用性。目錄目前顯示 448+ plugins，並列出：

| 類型 | 上游資料 | 對本專案的意義 |
|---|---:|---|
| Templates | 270 | 可執行／可視化 seed；含 prototype、deck、image、video、motion 等 |
| Skills | 16 | 純 `SKILL.md` 任務指令，應成為 deferred capability |
| Design systems | 150 | `DESIGN.md`、tokens、品牌與可近用性契約 |
| Craft | 目錄定位項 | 用作品質、可近用性與內容細節的 rule pack；需以實際 manifest 再決定資料格式 |

Templates 的定位不是只顯示縮圖：上游將其視為可 fork、替換資料後交付的範本，通常附 `example.html`。本專案已在 `app/public/open-design/` 收錄上游設計模板、prompt template 與官方 image/video template；下一步是把這些檔案變成可搜尋、可選、可追溯的受治理輸入。

### 2.2 Agent 目錄

上游列出 21 個 BYOK adapter，核心是「薄 shim 將各 CLI 的原生格式轉成共用 Skill protocol」。其中包含 Claude Code、Codex、Cursor Agent、Gemini CLI、GitHub Copilot CLI、OpenCode、Qwen Code、Grok Build、Hermes、Kimi CLI、Devin、DeepSeek、Pi、Mistral Vibe、Kiro、Kilo、Qoder、Trae、Aider、Antigravity 等。

上游的產品原則可直接採納：

- 每個 adapter 僅負責 binary probe、認證／模型發現、prompt I/O、stream parser、resume id 與 capability 宣告。
- BYOK 的 secret、成本、網路呼叫保留在使用者電腦與帳戶。
- Skill／DESIGN.md 不應綁死某個 agent shell。

## 3. 現況對照

| 整合面 | SubAgents AI 現況 | 判斷 |
|---|---|---|
| Plugin manifest | `agent/hermes/plugins.ts` 已有 JSON manifest、skills、declarative tool、MCP、connector auth、hook、package review | 可擴充，不需新增第二套 plugin registry |
| Skill loading | `agent/hermes/skills.ts` + `capabilities/runtime.ts` 動態產生 `skill:<name>` | 可直接承接上游 SKILL.md；需要 source/provenance 與相容性檢查 |
| Design system | SubDesign 已掃描／注入 `DESIGN.md`、tokens 與摘要 | 可導入上游 systems；需增加 manifest、asset policy 與更新策略 |
| Template catalog | `agent/subdesign/templateCatalog.ts` + `app/public/open-design/` | 已有入口與本地來源；需從 hand-curated catalog 升級為 manifest index |
| MCP / connector | 動態 MCP capability、secret owner、fallback connector、HITL | 強於上游 shim；不得讓導入 manifest 繞過 `toolGuard` |
| CLI provider | `cliProviders.ts` 目前有 OpenAI、Claude、Google、OpenCode、Cursor、Codex、Grok、custom | 可擴充，但目前只有部分上游 21 agent 有第一方 runner |
| CLI dispatch | `runDispatch.ts` → `localCliRun.ts`，並由 global mutex / queue 管理 | 必須保持單一 dispatch path，禁止 adapter 自行 spawn 未受管 process |
| Role models | `roleModels` 對應 orchestrator / analyst / synthesizer / executor | 適合做 adapter capability-aware routing，而非照抄上游單一 agent picker |

## 4. 目標架構

```text
Open Design vendor source / optional remote catalog
  └─ OpenDesignCatalogIndexer (read-only)
       ├─ TemplateRecord ──> SubDesign template chooser / brief.templateId
       ├─ SkillRecord ─────> plugin manifest → skill:<name> capability
       └─ SystemRecord ────> DesignSystemSummary → design-system capability

Settings / Marketplace
  └─ OpenDesignPackInstaller
       ├─ provenance + license inventory
       ├─ content digest / version pin
       ├─ user enablement
       └─ ToolPackage review + secret policy (if a pack declares tools)

Agent runner registry
  └─ CliAdapterDefinition
       ├─ discover / auth diagnostics / model discovery
       ├─ prompt transport + event parser + resume mapping
       └─ capabilities / sandbox declaration
            └─ existing runDispatch → toolGuard → capability runtime → queue
```

### 不變條件（non-negotiable）

1. 上游 manifest、SKILL.md、example HTML、README 都是**不可信內容**；僅可做資料解析，不能指示本機執行任意 shell 或自動安裝依賴。
2. 所有 network、write、bash、MCP、OAuth 動作仍由 `authorizeTool`／HITL、package fingerprint review 與 `pluginSecrets` 管理。
3. 新 agent adapter 不可自行保存 token；只讀既有 secret provider 或執行使用者已登入的 CLI。
4. 必須保留 source URL、commit/digest、license path、更新時間；更新不得覆寫使用者自訂 pack。
5. 任何 media（image/video/audio/HyperFrames）在對應 renderer、model route、export path 尚未實作前，只能顯示為「已安裝內容，尚不可執行」。

## 5. 分期計畫

### Phase 0 — 清點與索引（優先）

**目標**：使已 vendoring 的內容可被可靠地列出，沒有執行風險。

- 新增 `agent/openDesign/catalog.ts`：掃描 `app/public/open-design/` 的 templates、prompts、official image/video packs。
- 建立 `OpenDesignCatalogRecord`：`id`、`kind`、`category`、`title`、`summary`、`sourcePath`、`assetPaths`、`licensePaths`、`upstreamCommit`、`sha256`、`executionStatus`。
- 解析 JSON 前加檔案大小、深度、字串長度與 schema 限制；未知欄位不執行、只保存 metadata。
- 產出 `OPEN_DESIGN_INVENTORY.json` 與 UI 讀取的 cache；不把 1,336 檔一次塞進 prompt。
- Template UI 改為讀 index，搜尋／category filter 可展示全部本地內容；詳情頁顯示來源與授權。

**驗收**：index 在無網路時可重建；每個可見項目能追到本地 source/license；壞 JSON 不會讓 renderer 或 agent 崩潰。

### Phase 1 — Content Pack 安裝器

**目標**：讓 Template / Skill / System 成為本專案的可管理內容，而非散落 static file。

- 定義 `OpenDesignContentPackManifest`，只接受 declarative metadata；不接受任意 JS hook。
- 將 Template、Skill、Design System 分開安裝與啟用；每包可 pin version／digest。
- Skills 轉為 Hermes skill，帶 `source: open-design`、license、content digest、surface/mode tags。
- Design systems 寫入 `.subagents/subdesign/design-systems/<id>/`，保留 `DESIGN.md`、tokens、assets 與 attribution。
- 只有 pack 顯式宣告的 declarative custom tool／MCP 才進入既有 `PluginManifest`；第一次使用須 package review，secret 欄位走 `pluginSecrets`。
- 支援 disable、uninstall、re-index；不刪除 project 產物與使用者自己修改的 pack。

**驗收**：安裝／停用／移除都有 inventory audit trail；無權限的 pack 不會增加 tools schema；來源 template 可離線使用。

### Phase 2 — Design workflow 連接

**目標**：讓選擇的內容真正影響 SubDesign，但不強迫模型照抄範例。

- `SubDesignBrief` 記錄 `templateId`、`skillIds`、`designSystemId`、`provenance`。
- prompt builder 只注入選定範本的 summary、結構 contract、必要檔案與授權提醒；長內容採 `load_capability`／tool search 取得。
- Template preview 使用 sandbox renderer；外部 script、network、iframe、form submission 預設封鎖或明確允許。
- 建立 artifact 時複製為 project-owned output，不直接修改 vendor source。
- Critique 增加 template attribution、design-system conformance、asset-license presence 三項 evidence。

**驗收**：重開 thread 仍可恢復選定 pack；生成成果可追溯到來源，但不寫回 vendor tree。

### Phase 3 — Agent adapter framework

**目標**：以一個明確 contract 快速支援更多 CLI，而非堆疊 provider-specific if/else。

新增 `CliAdapterDefinition`：

```ts
type CliAdapterDefinition = {
  id: string
  displayName: string
  binaryCandidates: string[]
  credentialMode: 'env' | 'subscription' | 'cli-login' | 'provider-config'
  promptTransport: 'stdin' | 'argv' | 'file'
  streamFormat: 'jsonl' | 'text' | 'provider-json'
  supports: {
    resume: boolean
    images: boolean
    mcp: boolean
    sandbox: 'none' | 'cli-native' | 'subagents-gated'
  }
  discover(): Promise<AdapterDiagnostics>
  buildInvocation(input: RunnerInput): SpawnSpec
  parseEvent(line: string): RunnerEvent | null
}
```

第一批 priority（依本專案現有設定與設計任務適配性）：

1. **Codex、Claude Code、OpenCode、Gemini CLI、Cursor**：整理成同一 contract，先補齊 probe、stream、resume、sandbox diagnostic。
2. **GitHub Copilot CLI、Qwen Code、Kimi CLI、Aider、Pi、Mistral Vibe**：每次只加一個，需有 binary/auth/model/error contract 與 mock stream fixture。
3. **Trae、Kilo、Qoder、Kiro、Devin、Antigravity、DeepSeek 系列、Grok Build、Hermes**：先做 discovery card，不承諾 runner；有穩定 CLI contract、明確 token ownership 和 smoke fixture 才升級為可執行。

**驗收**：新 adapter 不改 `runDispatch` policy；未安裝／未授權／不支援某能力時有精確診斷；resume id 不跨 provider 使用；所有 shell spawn 仍通過 CLI authorization。

### Phase 4 — BYOK、UX 與發布治理

**目標**：使用者可以安全理解「哪個 agent、哪個 pack、用哪把 key、能做什麼」。

- Settings 顯示 adapter capability matrix：已安裝、已授權、MCP、image、resume、sandbox、最後 probe。
- 將 roleModels 只列出被授權且 capability 相容的 models；設計任務在不支援圖片／media 時降級為 brief/HTML plan。
- 設置 pack 信任狀態：bundled、community-reviewed、local-user、remote-unverified；預設 remote-unverified 停用。
- Export 與 media route 另立審核，禁止 template 安裝隱性下載模型、執行 `npx` 或外連。
- 新增 telemetry-free local audit log：pack id/digest、adapter id/version、permission decisions、artifact attribution；不得記錄 raw secret 或完整私有 prompt。

**驗收**：使用者可在一次頁面中確認資料來源、授權、執行 agent、權限與成本責任；關閉 pack／adapter 後不可留存可執行工具。

## 6. 風險與決策

| 風險 | 影響 | 控制措施 |
|---|---|---|
| SKILL.md / README prompt injection | agent 被誘導執行不受控命令 | 視為資料、限制解析、技能以 runbook 層載入、toolGuard 最終裁決 |
| 57 MB bundled assets 影響 package 體積 | build / update 變慢 | Phase 0 加 inventory；Phase 4 考慮 optional content packs、按需下載但必須 digest 驗證 |
| 上游 license 混合 | 重散布時遺失 attribution | `NOTICE` + license inventory + CI 檢查每個 vendor source 的 license path |
| CLI adapter 非穩定 | spawn / stream / resume 失敗 | adapter feature flags、fixture、version probe、逐個 staged rollout |
| BYOK / OAuth secret 外洩 | 高風險 | 只存 secret reference、主程序解析、renderer 永不讀 raw token、匯出時 redact |
| 模板帶 external script 或 tracking | preview 資安與隱私風險 | sandboxed preview、CSP、預設 deny network、URL allow-list |
| 兩套 plugin lifecycle | 安裝狀態漂移 | 僅用現有 `pluginRegistry`／Settings persistence；Open Design 是 content source，不另開 registry |

## 7. 建議完成順序與 DoD

| 順序 | 成果 | DoD |
|---:|---|---|
| 1 | Content inventory | 可離線重建、含 source/digest/license、無任意程式執行 |
| 2 | Catalog UI | 全部本地內容可搜尋與分類，media 狀態誠實揭露 |
| 3 | Skill/System pack | 可安裝、停用、移除、version pin，且走 capability runtime |
| 4 | Template-to-artifact | sandbox preview、project-owned copy、critique provenance |
| 5 | Adapter contract | 既有五個核心 CLI 完整 adapter fixtures 與 diagnostic |
| 6 | Additional agents | 每個 provider 有獨立 smoke fixture、權限 matrix、rollback flag |
| 7 | Optional remote marketplace | signed/digested pack、manual enable、license UI、release audit |

## 8. 明確不做

- 不導入 Open Design 的 Next.js UI、Express daemon、SQLite 或 media daemon 作為平行 runtime。
- 不自動安裝 agent binary、npm package、MCP server 或模型。
- 不因使用上游 plugin 而繞過 package review、HITL、shell policy 或 secret store。
- 不把 source template 當作使用者產物；所有修改與 export 必須落在 project-owned 路徑。
- 不在上游未提供穩定 CLI contract 時宣稱該 21 agent 已可在 SubAgents AI 執行。
