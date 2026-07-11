# 自動載入・參數自動帶入・工具庫豐富化 — 稽核與路線圖

> 稽核日期:2026-07-11 · 前置:`docs/WORKFLOW_AUDIT.md`(工作流呼應關係已全數修復並複驗)
> 本文件回答三個問題:哪些東西**已經會自動載入**?哪些設定**可以自動帶入卻還要手填**?
> 工具庫要怎麼**規模化地變豐富**(而不是一個一個手刻)?

---

## 0b. 實作狀態(2026-07-11 第三輪複驗)

| 項目 | 狀態 | 驗證錨點 |
|---|---|---|
| A1 宣告式自訂工具 | ✅ 已實作 | `tools/customTools.ts`(http/bash template、`{{secret:*}}`、settings > plugin 優先);FC pool + run_code 內部皆可呼叫;`source:'user'` capability(`runtime.ts:93`);secrets 匯出遮蔽/匯入保留;Settings JSON 編輯器 |
| A2 MCP 一鍵匯入 | ✅ 已實作 | `electron/mcpDiscover.ts`(claude_desktop_config / .mcp.json)→ `mcp:discover` IPC → Settings「一鍵匯入 MCP」 |
| A3 目標感知 preload | ✅ 已實作 | `runDispatch.ts`: `selectToolsForStep` → `capabilityOwnsTool`，預載最高訊號 1–2 包 |
| A4 專案感知 preload | ✅ 已實作 | 有 project root 時預載 `codegraph`/`workspace`；無 root 時 `runtime.ts` 不列 `codegraph` |
| B1 模型清單自動帶入 | ✅ 已實作 | `testConnection` 存 `discoveredModels` → 模型欄/角色欄 datalist(`ConversationSettings`、`SettingsPage`) |
| B2 roleModels 建議 | ✅ 已實作 | `SettingsPage.tsx:311` 依強度 rank 一鍵建議 |
| B3 webhook token 自動產生 | ✅ 已實作 | `SettingsPage.tsx:1699` `crypto.randomUUID` |
| B4 供調參自動預設 | ✅ 已實作 | `modelTuning.ts` 依 model id 的 context suffix 推導建議；Settings 可一鍵套用 threshold/payload/rounds |
| C1/C3/C6(git/csv/RSS) | ✅ 已實作 | `example-edge` 外掛預置 git/RSS template；核心 `table_parse` 提供 CSV/TSV 解析 |
| C2/C4/C5(下載/檔管/json_extract) | ✅ 已實作 | `workspace_download`、mkdir/move/delete（move/delete 強制核准）、`json_extract_lite` 正名 |

第三輪同時補上 approvalMode 的兩個安全死角(見 `WORKFLOW_AUDIT.md` 第 6 節):
custom 工具的 `sideEffect` hint(`always` 模式補網)、unattended `full → auto` 強制降級。

**第四輪複驗(同日)**:上表全部項目接線驗證通過(`WORKFLOW_AUDIT.md` 第 7 節);
過程中發現並修復 C2/C4 新工具漏出 `SIDE_EFFECT_TOOLS` 的 drift,
並新增 smoke「side-effect drift guard」契約測試治本。
**第四輪後 R1 亦已消化**：外部 CLI runner 會接收 approvalMode；僅互動 build 的
Codex/Claude `full` 映射 permissive flag，無人值守、Plan mode 與未明確支援的 CLI 一律保留預設核准。

**第六輪(同日)— 工具庫再擴張**:Plugin Marketplace 上線,11 家連接器
(GitHub/Notion/Google Calendar/Sheets/Linear/Figma/Asana/ClickUp/Dropbox/Canva/Home Assistant)
以 A1 的 customTools 機制出貨,OAuth device/code(+PKCE)授權、token 自動刷新、
secrets 三層隔離(見 `WORKFLOW_AUDIT.md` 第 9 節)。
「豐富工具庫」路線自此從核心手刻 → 宣告式自訂 → **目錄化市集**三級完成。

---

## 0. 本輪複驗摘要

前輪 G1–G6 已全數實裝且接線正確(抽驗):

| 修復 | 接線驗證 |
|---|---|
| 跨 run capability 恢復 | `threadStore.lastCapabilityIds/lastUnlockedTools` → `runDispatch.ts:146-160` 回灌 → run 結束 `setLastCapabilities`(`runDispatch.ts:176`) |
| 自動化佇列(含持久化) | `App.tsx:31-46` hydrate + drain;`runExternal.ts:95,189,209` 入列/消化 |
| run_code 網路隔離 | `codeMode.ts:34-36`(fetch/XHR/WebSocket 禁用) |
| smoke 覆蓋 | `npm run smoke` = 原 9 測試 + capability 8 測試,全綠;`npm run build` 通過 |

---

## 1. 現況:已存在的自動載入掛載點

先盤點已經做到的,避免重工:

| 機制 | 內容 | 位置 |
|---|---|---|
| 一鍵偵測本機 CLI | 掃 `~/.codex`、`~/.claude`、`~/.grok`、`opencode.jsonc` → 匯入 cliProviders + 模型清單(不碰 secrets) | `SettingsPage.tsx:1054-1083` + electron `cliDiscover` |
| OpenCode config 水合 | `opencode.json` + `agents/*.md` 自動載入;**project root 變更時自動 re-hydrate** | `App.tsx:368-380` → `opencodeConfigStore` |
| Plugin(JSON 外掛) | 注入 skills + prompt 片段 → skills 自動成為 `skill:*` capability | `hermes/plugins.ts` → `learningStore` → `runtime.ts skillCaps()` |
| 學習迴圈 | 成功 run 自動產技能草稿/記憶 → 回流 capability 目錄 | `learning.ts` |
| 漸進披露 + Tool Search | 工具 schema 的「自動載入」本體:用到才展開、過多先藏 | `capabilities/runtime.ts` |
| 跨 run capability 恢復 | 續聊自動 preload 上輪已載入的能力 | 見上表 |

---

## 2. 缺口 A|自動載入(套件層)

### A1|外掛不能真正新增「工具」— 工具庫規模化的關鍵缺口 ★★★

- **現況**:`PluginManifest.toolHints` 註明 *"handlers stay core"* — 外掛只能給工具「取名字和描述」,
  沒有執行體;工具庫要變豐富,目前唯一路徑是改 4 個核心檔
  (`registry.ts` + `schemas.ts` + `executor.ts` + `builtins.ts`),完全不符合
  plugins.ts 開頭宣告的 Hermes 哲學「capability lives at the edges」。
- **證據**:`AgentCapability.source` 型別已預留 `'user'`,但**全 codebase 沒有任何路徑會產生
  user capability** — 掛載點做了,內容從缺。
- **提案:宣告式自訂工具(Declarative Custom Tools)**
  兩種安全可控的 handler 型別,不需外掛寫 JS:
  ```jsonc
  // PluginManifest 或 Settings → 自訂工具
  {
    "customTools": [
      {
        "name": "jira_search",
        "description": "Search JIRA issues by JQL",
        "kind": "http_template",           // 或 "bash_template"
        "template": {
          "method": "GET",
          "url": "https://jira.example.com/rest/api/2/search?jql={{jql}}",
          "headers": { "Authorization": "Bearer {{secret:jiraToken}}" }
        },
        "params": { "jql": { "type": "string", "required": true } },
        "requiresApproval": false          // bash_template 一律強制 true
      }
    ]
  }
  ```
  - 組裝成 `source: 'user'` capability(每個外掛一個包,deferLoading 預設 true)
  - 執行走既有管線:`authorizeTool`(bash_template 強制 `forceAsk`)+ supervisor payload 限制
  - secrets 以 `{{secret:key}}` 引用 Settings 加密欄位,不落盤在 manifest
  - **效益**:工具庫從「核心團隊手刻」變成「使用者/外掛自助」,且審批與審計不破口

### A2|MCP 伺服器純手動設定 ★★

- **現況**:`settings.mcpServers` 只能在 Settings 一筆筆手填(`SettingsPage.tsx:1784+`);
  但本機常已有現成設定檔。
- **提案**:「一鍵匯入 MCP」— 掃 `~/.claude/claude_desktop_config.json`、專案 `.mcp.json`、
  `opencode.jsonc` 的 mcp 區段 → 去重匯入 `mcpServers`(沿用 cliDiscover 的檔案掃描基礎,
  同樣不複製 secrets,token 欄留白提示補填)。匯入後自動出現 `mcp:*` capability,零額外接線。

### A3|目標感知自動 preload(FC 路徑)★★

- **現況**:heuristic 路徑已會「選到工具就自動 load 所屬包」,但 **FC 主路徑**第一輪
  只有目錄行,模型得花一輪 `load_capability`。`parser.ts` 解析 objective、
  `TOOL_CATALOG` 有 keywords,兩者已存在卻沒接起來。
- **提案**:parse 完成後以 keywords 對映 capability(`selectToolsForStep` 的既有邏輯 →
  `capabilityOwnsTool` 反查),取信心最高的 1–2 包塞進 `preloadCapabilityIds`。
  純 prompt 層優化,漸進披露語意不變(其餘包仍是目錄行)。

### A4|專案感知 preload ★

- 選定 project root(`projectStore`)→ 自動 preload `codegraph` + `workspace`;
  未選專案時反向保證 codegraph 不佔目錄行。與 A3 同一個 preload 組裝點,順帶做。

---

## 3. 缺口 B|設定參數自動帶入

### B1|模型清單不會自動帶入 ★★★(最低成本/最高體感)

- **現況**:「預設模型」是純文字框(`SettingsPage.tsx:897`,placeholder 寫「由 CLI 偵測或手動填入」);
  而 `testConnection` **已經會打 `GET {baseUrl}/models`**(`settingsStore.ts:114`),
  拿到清單後只回一句「reachable」就把資料丟了。
- **提案**:測試連線成功時把 model id 清單存起來(如 `settings.discoveredModels`),
  模型輸入框加 `<datalist>`;roleModels 四個槽同樣吃這份清單。做完後
  「填 baseUrl+key → 按測試 → 下拉選模型」一氣呵成。

### B2|roleModels 空槽沒有建議值 ★★

- **現況**:四個角色槽空白 = 全部 fallback 到全域 model,CLI 偵測匯入一堆模型後仍要手動分配。
- **提案**:偵測/匯入完成時給一次性建議(可整批套用、可改):
  orchestrator/synthesizer → 最強模型;analyst/executor → 快模型
  (依 provider 模型清單的深度標記 `depths` 排序,`cliProviders.ts` 已有此欄位)。

### B3|webhookToken 空值 = 無驗證 ★★

- **現況**:`webhookEnabled` 打開而 token 空字串時,本機 HTTP 端點無鑑別。
- **提案**:首次啟用 webhook 時自動產 random token 帶入欄位(使用者可改可清),
  UI 標示「留空 = 不驗證(不建議)」。

### B4|供調參的自動預設 ★(可延後)

- `toolSearchThreshold`、`maxToolPayloadKb`、`maxToolRounds` 均為固定預設;
  可依所選模型的 context window(provider 目錄可帶 meta)自動調整建議值。
  影響小,放最後。

---

## 4. 缺口 C|工具庫本體的豐富度

> 原則:**先做 A1**,讓下面大多數項目變成「外掛/設定就能加」,而不是核心一個個刻。

| # | 缺什麼 | 現況替代 | 建議路徑 |
|---|---|---|---|
| C1 | 結構化 git 工具(status/diff/log/branch) | `bash`(每次過 ask) | A1 的 `bash_template` 預置包(唯讀 git 指令免審批、寫入型強制審批) |
| C2 | 檔案下載(URL → workspace) | `http_fetch` 只回文字 | 核心小工具 `workspace_download`(掛 `workspace` 包 + supervisor 大小上限) |
| C3 | csv / 表格解析 | 無 | A1 預置包或核心 `table_parse`(純函式,零風險) |
| C4 | workspace 檔案管理(delete/move/mkdir) | 無(只有 list/read/write) | 核心補齊,`workspace_delete` 掛 `approvalTools` |
| C5 | `json_extract` 名不符實 | heuristic 欄位抽取,效果差 | 改為 LLM 結構化抽取(小模型 + JSON schema),或更名 `json_extract_lite` 以免模型高估它 |
| C6 | RSS / sitemap 讀取 | `http_fetch` 生啃 XML | A1 `http_template` 預置示範包(兼當外掛系統的 dogfood 範例) |

---

## 5. 建議實作順序

| 順位 | 項目 | 理由 |
|---|---|---|
| 1 | **B1** 模型清單 datalist | 資料已在手,只差存下來;所有使用者第一分鐘就受益 |
| 2 | **A1** 宣告式自訂工具 + `source:'user'` capability | 工具庫規模化的槓桿點,C1/C3/C6 隨之免費 |
| 3 | **B2 + B3** 角色模型建議、webhook token 自動產生 | 低成本收尾設定體驗 |
| 4 | **A2** MCP 一鍵匯入 | 復用 cliDiscover 模式,擴大 `mcp:*` capability 供給 |
| 5 | **A3 + A4** 目標/專案感知 preload | prompt 效率優化,依賴穩定的 capability 版圖 |
| 6 | **C2 / C4 / C5** 核心工具補齊 | 必須進核心的少數;其餘走 A1 |

---

*驗證方式:靜態追蹤 + `npm run build` + `npm run smoke`(第五輪:9+16=25 測試全綠)。
本計畫已全數落地(見 0b 狀態表與 `WORKFLOW_AUDIT.md` 第 8 節收斂宣告);
第 2–5 節保留原始提案內容作為設計依據。*
