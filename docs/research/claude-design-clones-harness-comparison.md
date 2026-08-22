# 「Claude Design」 clones：開源競品 harness 工程比較研究（延伸 2026-08-20 報告）

> 調查日期：2026-08-22
> 「近三個月」門檻：GitHub `pushed_at >= 2026-05-22`。活躍度以 default branch commits atom feed 的最新 `<updated>` 時間戳為準（可視為 `pushed_at` 的下界；若其他 branch 有更新 push 不會反映在此，已於各節註明）。
> 方法註記：GitHub API 於調查當下對本機 IP 與 webfetch 出口皆回 403 rate limit，因此改用 [github.com repo 頁面 HTML](https://github.com/dyad-sh/dyad)（star 數、license）與 [commits atom feed](https://github.com/dyad-sh/dyad/commits/main.atom)（精確時間戳）直接驗證，並輔以 websearch。所有 star／license／日期數字均來自 2026-08-22 當天的 GitHub 頁面或 feed。

本報告延伸 [open-design-harness-integrations.md](./open-design-harness-integrations.md)（2026-08-20）：該份涵蓋 nexu-io/open-design、MCP Apps、Storybook MCP、Chrome DevTools MCP、Harness、OpenGenerativeUI、TypeUI；本份不重寫其結論，聚焦「Claude Design／Claude Artifacts」風格的**其他**開源 clone 與競品，並做全新的缺口分析。

背景：[Anthropic Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs)（依 [awesome-claude-design README](https://github.com/rohitg00/awesome-claude-design) 所載於 2026-04-17 發布）帶動了一波開源 clone；同時 SubDesign 已於 2026-08-22 移除內部 Design System 功能（`DESIGN.md` contract、picker、`design_system_*` tools），本報告的生態觀察會說明這個決定與生態走向的一致性。

## 結論

兩個最重要的發現：

1. **Pi 生態收斂。** 兩個新興 clone 都直接建構在 AgentTeam vendored 的同一套 Pi 基礎上：[Open CoDesign](https://github.com/OpenCoworkAI/open-codesign) 明列 `@mariozechner/pi-ai` 與 `pi-coding-agent`（見其 README〈Built on〉一節），[Boring UI](https://github.com/hachej/boring-ui) 以 Pi 作為唯一 agent harness（見其 README〈Built on Pi〉）。這代表它們的 session/tool/approval 語意與 AgentTeam 高度可比，是「別人怎麼用同一塊積木做 design agent」的最佳鏡子，而非需要移植的外部架構。
2. **Artifacts 正在從「chat 內預覽」演變成「可分享、可評論、agent 會讀回評論的交付物」。** [Glance](https://github.com/plivo-labs/glance) 把 deploy → 瀏覽器留言 → agent 讀留言 → 修正 → 再部署做成閉環；[Open Artifacts](https://github.com/coda0HQ/open-artifacts) 用 Recipe/manifest/channel token 解決版本與穩定網址。AgentTeam 的 artifact pipeline 到 export 為止，「交付後的 review 迴路」是最大的單一缺口。

優先順序（詳見第三節的整合建議）：

1. **P0：Critique 加入 deterministic verification gates**——借 [ux-ui-agent-skills](https://github.com/plugin87/ux-ui-agent-skills) 的「run gates, never claim」協定與 Open CoDesign 的 boolean parity rubric，讓分數必須由 Pi Core 執行的 gate 產出 non-model evidence，直接落實 ADR-0048 execution evidence。
2. **P0：Element-pinned comment → scoped patch**——借 Open CoDesign 的 Comment mode（點元素、放 pin、模型只重寫該區域），把 pin 轉成結構化 patch operation 走既有 `runTask`。
3. **P0：Artifact revision snapshot / restore / diff**——AgentTeam types 已有 `revision` 與 `sha256`，但缺少 Open Artifacts 式 immutable version + 衝突偵測與 Dyad 式 checkpoint restore 的使用者操作。
4. **P1：react-component artifact 的可執行預覽 contract**——Open CoDesign（vendored React 18 + Babel on-device）與 LlamaCoder（esbuild-wasm + esm.sh）提供兩條已驗證路徑；CSP 採 Open Artifacts 的 `sandbox` + `default-src 'none'` opaque origin 模式。
5. **P1：local-first review 迴路**——先做專案內結構化留言（不雲端），語意比照 Glance（留言一律正規化為文字供 agent 讀取）。
6. **P2：self-hosted publish/share lane**——僅在 Outbound Data Gate 政策允許時開啟，加密採 zero-knowledge client-side 模式。
7. **P2：DESIGN.md 生態以外部內容處理**——透過既有 OpenDesign catalog / plugin trust 路徑匯入，不重建內部 Design System。

## 近三個月候選總表

以下數字均為 2026-08-22 驗證。

| Repo | 最後推送 | Stars | 授權 | 定位 |
|---|---:|---:|---|---|
| [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit) | 2026-08-22 | 36,945 | MIT | Generative UI SDK（前次報告已覆蓋其 OpenGenerativeUI 子計畫） |
| [dyad-sh/dyad](https://github.com/dyad-sh/dyad) | 2026-08-21 | 21,296 | Apache-2.0（`src/pro` 為 FSL 1.1） | 本地 Electron AI app builder（v0/Lovable/Bolt alternative） |
| [plivo-labs/glance](https://github.com/plivo-labs/glance) | 2026-08-21 | 31 | MIT | 任何 coding agent 的 self-hosted Artifacts + 瀏覽器評論迴路 |
| [hachej/boring-ui](https://github.com/hachej/boring-ui) | 2026-08-21 | 45 | MIT | 建構在 Pi harness 上的 agent-centric app framework |
| [coda0HQ/open-artifacts](https://github.com/coda0HQ/open-artifacts) | 2026-08-20 | 46 | MIT | Self-hosted Claude Code Artifacts 發布引擎（Cloudflare） |
| [gptme/gptme](https://github.com/gptme/gptme) | 2026-08-20（master） | 4,392 | MIT | Terminal agent harness（watchlist，非 design 專用） |
| [e2b-dev/fragments](https://github.com/e2b-dev/fragments) | 2026-08-17 | 6,371 | Apache-2.0 | Claude Artifacts/v0 開源版，E2B Firecracker sandbox 執行 |
| [Nutlope/llamacoder](https://github.com/Nutlope/llamacoder) | 2026-08-14 | 7,119 | MIT | LlamaCoder（原 togethercomputer/llamacoder）— esbuild-wasm 瀏覽器內 bundling |
| [srcbookdev/srcbook](https://github.com/srcbookdev/srcbook) | 2026-07-30 | 3,444 | Apache-2.0 | TypeScript notebook + AI app builder（watchlist） |
| [refly-ai/refly](https://github.com/refly-ai/refly) | 2026-07-29 | 7,490 | Apache-2.0 + additional conditions | Canvas 式 AI workflow（watchlist） |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | 2026-07-22 | 26,534 | Apache-2.0 | 對真實 codebase 的 visual editor（Figma-like） |
| [vercel/chatbot](https://github.com/vercel/chatbot) | 2026-07-08 | 20,854 | Apache-2.0 | AI SDK chatbot template（artifacts 參考實作） |
| [plugin87/ux-ui-agent-skills](https://github.com/plugin87/ux-ui-agent-skills) | 2026-06-22 | 507 | MIT | 設計 skills 套件：DTCG tokens、WCAG gates、verification protocol |
| [opencoworkai/open-codesign](https://github.com/opencoworkai/open-codesign) | 2026-06-06 | 7,801 | MIT | Electron Claude Design alternative，建構在 pi-ai / pi-coding-agent 上 |

窗外參考（architecturally pivotal 或生態脈絡，明確標記為超出三個月門檻）：

- [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy)：main branch 最後推送 2026-02-07、stable branch 2025-05-12（commits atom feed），~19.8k stars，MIT。發展明顯趨顯趨緩，僅作為 WebContainer 型 in-browser runtime 的架構參考。
- [rohitg00/awesome-claude-design](https://github.com/rohitg00/awesome-claude-design)：最後推送 2026-04-23（atom feed），~1.1k–1.2k stars，MIT。DESIGN.md 生態指標。
- [mayfer/open-artifacts](https://github.com/mayfer/open-artifacts)：2025-02-23 後無推送，早期 esbuild-wasm 先驅。

消失或搬移（今日 404，曾為常見候選 seed）：

- `e2b-dev/artifacts`、`OpenBMB/OpenArtifacts`、`togethercomputer/llamacoder` 三個 repo 於 2026-08-22 回傳 HTTP 404（無 redirect）。llamacoder 現存於 [Nutlope/llamacoder](https://github.com/Nutlope/llamacoder)。引用舊連結時需注意。
- `maxtechera/hushdrop`：repo 存在但 main 分支 atom feed 無法取得 commit 時間戳，活躍度未能驗證，故不入列。

## Harness engineering 比較表

判準說明：「sandbox」指生成物執行的隔離方式；「artifact contract」指生成物的表示與版本語意；「HITL」指人類介入點的形式。✅=有且明確、◐=部分/文件未明、❌=無。判斷依據以各 repo README/docs 為主（連結見各節），未讀原始碼處已標註。

| Repo | Runtime / adapter | Sandbox | Artifact contract | Streaming | HITL | Memory/context | Deploy/export | Evals |
|---|---|---|---|---|---|---|---|---|
| **AgentTeam 現況** | Pi Core utility process + `runTask` 單一入口 + external CLI matrix | Electron renderer sandbox + approvals + Outbound Gate | versioned manifest/renderer/export + `streamingEnvelope` | ✅（envelope + status: streaming） | Approval Mode + ask-user + Critique theater | brief/workspace/project context | html/pdf/zip/pptx/mp4/jsx/md/svg/txt | ◐（critique scores，gate 化進行中） |
| dyad | 主程序 response processor → XML tags；新 local agent 在 `src/pro`（FSL，未深讀） | renderer sandbox + host path policy（`capabilities.ts`） | `<dyad-write>` tag stream → file ops；git checkpoints（`git_utils.ts` 存在，細節未驗證） | ✅（stream 至自製 Markdown parser） | 審核 changes 後才 apply；Auto-fix 可關 | 全 codebase 注入 + Smart Context 小模型過濾 | 無內建 deploy（本地跑 dev server） | ✅ `vitest.eval.config.ts` + e2e engine fixtures |
| open-codesign | Electron + pi-ai/pi-coding-agent；permissioned pi built-ins | sandboxed iframe，vendored React18+Babel on-device；credentials 在本機 config.toml | workspace-backed session（JSONL history）+ `ui_kits/<slug>/manifest.json` | ✅（live tool call stream、可中斷） | permission UI gate 每個工具；Comment mode pin | `DESIGN.md` 作 shared memory；最近五案 iframe 保活 | HTML/PDF/PPTX/ZIP/MD 五格式 | ✅ BENCHMARKS.md：12-check boolean rubric、parityScore 公式、真實 run 數字 |
| boring-ui | Pi `AgentHarness`（interface 化，Pi 為唯一實作） | `Sandbox` interface：direct/bwrap/Vercel Firecracker 三 adapter | workbench 檔案即 artifact（Workspace interface 共享給 agent 與 UI） | ✅（chat stream + UiBridge 指令流） | `ask-user` plugin（UI 問答面） | Pi plugins hot-reload；session 管理 | 容器/Vercel sandbox 部署路徑 | `pnpm lint:invariants`（plugin contract lint）+ vitest |
| glance | harness-agnostic：CLI + agent skill 包裝 shell 指令 | 兩個 Workers 分離 content origin；HMAC single-use tokens | site = folder deploy；immutable versions、thread 評論、voice 轉文字 | ◐（部署後檢視，非 token stream） | ✅ 核心賣點：瀏覽器留言 → agent 讀取回覆 | 評論 thread 即回饋 context | Cloudflare R2/D1/KV self-host，$0 tier | ❌ |
| open-artifacts | harness-agnostic：SKILL.md + `artifact.mjs` CLI | CSP `sandbox allow-scripts` + `default-src 'none'` opaque origin | Recipe(JSON)+fragments、Manifest v2 hash、immutable versions、baseVersion 409 | ❌（一次 publish 一版） | password gate、writeToken/channel token 權限 | watch globs + auto-update staleness 报告 | Cloudflare Workers/D1/R2；OG 圖 edge rasterize | ✅ vitest workerd 整合測試 + BDD features |
| fragments | Next.js Server Actions + Vercel AI SDK | E2B Firecracker VM（`e2b.Dockerfile` + start_cmd 模板契約） | `templates.json` persona 契約（name/lib/file/instructions/port） | ✅（UI streaming） | ◐（聊天介入，無審核 gate） | chat history + KV short URLs | sandbox 內跑 dev server + 公開分享頁 | ❌（PostHog 觀測非 eval） |
| llamacoder | Next.js + Together AI 單次請求 | esbuild-wasm + esm.sh 於 sandboxed iframe 內 bundle | 單檔 app（esm.sh CDN imports） | ✅ | ❌ | ❌（每次重新 prompt） | 分享 URL + S3 截圖上傳 | Braintrust observability |
| onlook | 自家 agent + queue messages | 本地跑真實 Next.js dev server | 真 codebase 即 artifact；branching + checkpoints | ◐ | 右鍵元素直達 code 位置；real-time 協作 | codebase 即 context | 一鍵 deploy + custom domain | ❌ |
| vercel/chatbot | AI SDK（tool calls + generative UI hooks） | Vercel 平台責任 | AI SDK data-stream parts（含 artifacts） | ✅（RSC/data stream） | ◐（chat 介入） | Neon Postgres chat 持久化 | Vercel one-click | ❌ |
| CopilotKit | React SDK：`useCopilotAction` render-in-chat | host app 責任 | generative UI action 契約 | ✅ | human-in-the-loop action 中斷點 | app state 即 context | N/A（SDK） | ❌ |
| ux-ui-agent-skills | Claude Code skills（17 個 `/skills` + scripts） | 無（靜態分析 + real-render 腳本） | tokens(DTCG)/components/frameworks 檔案層 | ❌ | `.claude/settings.json` scripts allowlist | CLAUDE.md persona + reference/ 截圖庫 | N/A | ✅ 核心賣點：gates（accuracy_report N/N、verify_states、axe-core、responsive） |

## 各 repo 重點筆記

### dyad-sh/dyad — 架構上最近的「桌面型」同類

[README](https://github.com/dyad-sh/dyad)、[docs/architecture.md](https://raw.githubusercontent.com/dyad-sh/dyad/main/docs/architecture.md)、[docs/agent_architecture.md](https://raw.githubusercontent.com/dyad-sh/dyad/main/docs/agent_architecture.md)、[docs/security.md](https://raw.githubusercontent.com/dyad-sh/dyad/main/docs/security.md)。

- **Life of a request**：LLM 收到整包 codebase + system prompt，以 XML-like tag（如 `<dyad-write path="...">`）回應；renderer 用自製 [DyadMarkdownParser](https://github.com/dyad-sh/dyad/blob/main/src/components/chat/DyadMarkdownParser.tsx) 顯示，**使用者核准後** main process 的 [response_processor](https://github.com/dyad-sh/dyad/blob/main/src/ipc/processors/response_processor.ts) 才落地檔案。官方 FAQ 說明不用原生 tool calling 的理由（一次多工、JSON 降低 code 品質）。
- **轉向真 tool calling**：`agent_architecture.md` 明言舊 XML 策略已被取代，新的 local agent 核心（`src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts`）loop 到模型不再呼叫 tool 或到步數上限。注意：`src/pro` 是 fair-source（[FSL 1.1](https://fsl.software/)），我沒有深讀其原始碼，此段以官方 docs 為準。
- **安全模型值得抄**：`security.md` 說明 MustardScript attachment 檢查是 read-only、in-process、**不被視為 hard boundary**；真正 guard 是 `src/ipc/utils/sandbox/capabilities.ts` 的 host path policy——拒絕絕對路徑/home/UNC/`..` traversal、resolve symlink、保護 `.env*`、`.git/`、`node_modules/`、`.ssh/`、`.aws/`、`*.key` 等，並限制單次讀取量。「腳本不是邊界、host path policy 才是」的分工與 AgentTeam 的 Trusted Extension / Outbound Gate 分工同構。
- **成本自覺**：FAQ 直接回答「為什麼不多 agentic」——複雜 agent 迴圈會讓單一請求燒掉數美元，Dyad 選擇保持極淺的 loop。這對 SubDesign 的 critique 多 panelist 迴圈是很好的成本對照。
- **Evals**：root 有 [`vitest.eval.config.ts`](https://github.com/dyad-sh/dyad/blob/main/vitest.eval.config.ts)，`agent_architecture.md` 記錄 e2e engine fixture（`e2e-tests/fixtures/engine`）可模擬 tool call——「fixture 模擬 tool call」的做法可以直接映射到 SubDesign stage 測試。

### opencoworkai/open-codesign — 同一塊 Pi 積木的 Claude Design alternative

[README](https://raw.githubusercontent.com/OpenCoworkAI/open-codesign/main/README.md)。

- **Stack**：Electron + React 19 + Vite 6 + Tailwind v4，明列 `@mariozechner/pi-ai` 與 `pi-coding-agent`。v0.2.0「Agentic Design」把每個設計變成 **pi session（JSONL history）+ workspace 資料夾**，pi built-ins（read/write/edit/bash/grep/find/ls）全部過 Open CoDesign 自己的 permission UI。
- **設計工具即 tools**：`ask`、`scaffold`、`skill`、`preview`、`gen_image`、`tweaks`、`todos`、`done`——與 SubDesign 的 tool registry 思路相同，但多了 `tweaks`（模型自行emit值得調的參數 slider）與 `done`（明確完成宣告）兩個 SubDesign 沒有的形狀。
- **Comment mode**：點預覽中任何元素放 pin、留註解，模型只重寫該 region。這正是 AgentTeam ArtifactTweakPanel（宣告式 find/replace tweaks）缺少的「指向式」回饋。
- **Decompose to UI Kit + boolean parity rubric**：圖片 → `ui_kits/<slug>/`（index.html + components/*.tsx + tokens.css + manifest.json）；用 **12 題 yes/no rubric** 做 deterministic + vision 自查，`parityScore = passCount / totalChecks`，迭代後誠實暴露 regression（其 README 展示 iter-0 0.82 → iter-1 0.78 的分數漂移）。這是「分數必須可由 gate 重現」的具體實作，與 ADR-0048 完全同一哲學。
- **DESIGN.md 作 shared memory**：品牌 tokens 與設計決策是可編輯檔案而非模型記憶——生態正朝「design system 是檔案」走，佐證 AgentTeam 移除內部 Design System、改以外部內容處理的方向。
- 未竟事項（其 Roadmap 自承）：version snapshots + side-by-side diff、three-style parallel exploration、codebase → design system token extraction。SubDesign 若補齊 snapshots/diff 反而會領先。

### hachej/boring-ui — Pi harness 的「UI 延伸層」範本

[README](https://raw.githubusercontent.com/hachej/boring-ui/main/README.md)、[launch 文章](https://juhache.substack.com/p/launching-boring-ui)。

- 四元件：Web Frontend / Web Backend / **Pi Harness**（`AgentHarness` 是 interface，目前唯一實作是 Pi）/ **Sandbox**。
- 核心公理：「agent 與 user 透過**同一組 primitives**互動」——單一 File API 同時服務前端 file tree 與 agent filesystem tools；agent 用 UiBridge 指令（`openFile`、`openPanel`、`openSurface`）驅動 workbench，**不碰 DOM**。
- `Workspace` / `Sandbox` 成對出現（Node+Bwrap / Vercel Firecracker），Pi 原生 read/write/edit 工具在遠端模式被改寫成走 Workspace interface 的 HTTP 呼叫——「same tools, same agent, different backend」的 adapter 形狀很乾淨。
- **雙層 plugin manifest**：`package.json` 的 `pi.*`（extensions/skills/prompts/systemPrompt，hot-reload）+ `boring.*`（front panels/commands/catalogs + server routes）。任何 Pi plugin 開箱可用，再漸進加上 UI 面。`ask-user` plugin 就是 agent↔human 的 UI 問答面——等價於 AgentTeam 規劃中的 MCP Apps form/choice surface，但走的是自家 bridge。
- 對 AgentTeam 的啟示：Trusted Extension Pack 目前只覆蓋 agent 層；「UI 層的宣告式延伸點（panels/commands/catalogs + surface resolvers）」是一個尚未有的概念，且 boring-ui 已示範它可以不破壞「renderer 不持權限」的原則。

### plivo-labs/glance — 交付後 review 迴路的完整閉環

[README](https://raw.githubusercontent.com/plivo-labs/glance/main/README.md)。2026-06-29 建立、114 commits、MIT；stars 僅 31（早期專案），但工程完整度高。

- 迴路：`agent builds → glance deploy → URL → 你在瀏覽器像 Google Doc 一樣留言 → agent 讀 comments、修正 → redeploy`。附 CLI 與 [skills.sh](https://skills.sh) 安裝的 agent skill，Claude Code/Cursor/Codex/Cline/Aider 皆可驅動。
- **Voice comments 轉文字**：Whisper（Workers AI）best-effort 轉錄，transcript 即 comment body——agent 迴路永遠只讀文字，多媒體在入口就被正規化。這個設計決定對 AgentTeam 的 critique evidence 很重要：**證據進 agent 前先降維成文字/結構化資料**。
- 安全模型：app 與 content 分屬兩個 Workers（content origin 隔離 cookie）、gated links 用短效 single-use HMAC tokens、Markdown raw HTML 在嚴格 CSP 下失效、API key 只能窄化自己權限（不能 delete、不能 mint key）。`glance.db` 共享後端 opt-in 且由 parent frame broker credential、page 本身不持有憑證。
- 對 AgentTeam：不需要它的 Cloudflare 部分；需要的是「**artifact 有一個可留言的表面、留言是 first-class 資料、agent 經 `runTask` 讀取並回應**」這個語意。SubDesign 的 Critique/Deliver stage 可以完全 local-first 地實作同一迴路。

### coda0HQ/open-artifacts — artifact 版本與沙箱的最小完備契約

[README](https://raw.githubusercontent.com/coda0HQ/open-artifacts/main/README.md)。

- 每個 artifact 由 **versioned JSON Recipe + ordered fragments** 生成；create/update 在記憶體 compose+validate 後只送出一次 publish request。Manifest v2 記錄 Recipe/input/output hashes；拒絕直接 HTML CLI publish（強制走 Recipe 以保證可重現）。
- 版本語意：每次 publish 是 immutable version（可帶 label、各自 title/favicon/format/encryption state）；`PUT` 帶 `baseVersion`，衝突回 409。channel token 讓同一 URL 綁定多版本——「穩定連結 + 歷史」兩個願望同時成立。
- 沙箱：所有 user content 以 `Content-Security-Policy: sandbox allow-scripts ...; default-src 'none'; connect-src 'none'` 提供，腳本跑在 opaque origin、不能發任何外部請求。這是可以直接抄進 SubDesign ArtifactPreview / 匯出 HTML 的 CSP 範本。
- Zero-knowledge 密碼：PBKDF2-HMAC-SHA256（600k）+ AES-256-GCM 在 CLI 端加密，server 只存 `{salt, iv, ciphertext}`。若未來做分享功能，這是符合 Outbound Data Gate 精神（資料最小暴露）的模式。
- 其 bundled skill 內含 anti-AI-slop 設計守則與 5-direction 風格庫，明言改編自 [nexu-io/open-design](https://github.com/nexu-io/open-design) 與 [pbakaus/impeccable](https://github.com/pbakaus/impeccable)——open-design 的影響力正在往這類小型工具擴散。

### onlook-dev/onlook — 對真 codebase 的視覺編輯

[README](https://raw.githubusercontent.com/onlook-dev/onlook/main/README.md)。Apache-2.0、26.5k stars。核心差異：artifact 不是生成的孤島檔案，而是**真實 Next.js + Tailwind 專案**——右鍵任何元素直達程式碼位置、branching 實驗設計、checkpoint save/restore、real-time 協作。其 hosted 產品轉向 early access waitlist，開源 repo 定位為起點。對 SubDesign 的意義：ReferenceImportPanel 已能匯入 screenshot/url，但「從渲染元素反查結構」的雙向綁定仍是缺口（同 open-codesign Comment mode 的需求根源）。

### e2b-dev/fragments 與 Nutlope/llamacoder — 兩種執行沙箱哲學

- [fragments](https://raw.githubusercontent.com/e2b-dev/fragments/main/README.md)：Next.js 14 + Vercel AI SDK，生成碼在 **E2B Firecracker VM** 執行；stack/persona 以 `templates.json` 契約描述（name/lib/file/instructions/port），新增 stack = 加 Dockerfile + start_cmd。另接 [Morph apply model](https://morphllm.com/) 做 token-efficient code editing。適合「要跑 backend/streamlit」的場景，代價是需要雲端 VM。
- [llamacoder](https://raw.githubusercontent.com/Nutlope/llamacoder/main/README.md)：**esbuild-wasm + esm.sh 在瀏覽器內 bundle**、sandboxed iframe 執行，零後端運算；Braintrust 做 observability。與 bolt.diy 的 WebContainer 屬同一陣營（in-browser runtime）。
- 對 AgentTeam：SubDesign 的 `react-component` artifact kind 目前缺一個明確的 live 執行故事。llamacoder/esm.sh 路線零基礎設施但依賴外部 CDN（與 Outbound Gate 有張力）；open-codesign 的 vendored React 18 + Babel on-device 路線完全離線、更貼近 local-first 原則。

### vercel/chatbot 與 CopilotKit/CopilotKit — contracts 的上游

- [vercel/chatbot](https://raw.githubusercontent.com/vercel/chatbot/main/README.md)（前身 ai-chatbot，已改名）：AI SDK data-stream parts 是目前事實上的 streaming artifact envelope 參考；Neon/Blob 持久化。前次報告對 OpenGenerativeUI 的 streaming 借鑑結論不變，此處僅補充：上游模板本身仍在活躍維護（2026-07-08 推送）。
- [CopilotKit](https://github.com/CopilotKit/CopilotKit)：`useCopilotAction` 的 render-in-chat + human-in-the-loop 中斷點是 generative UI 的 SDK 形狀；AgentTeam 已選擇 MCP Apps 作為同類能力，維持前次報告「借 contract、不引入第二 orchestration core」的結論。

### plugin87/ux-ui-agent-skills — 「run gates, never claim」協定

[CLAUDE.md](https://raw.githubusercontent.com/plugin87/ux-ui-agent-skills/main/CLAUDE.md)、[README](https://github.com/plugin87/ux-ui-agent-skills)。MIT、507 stars、2026-06-22 仍在推送。

- Verification Protocol 的第一條就是：「**Never state a number you did not measure.** 任何 contrast ratio、『WCAG pass』、『100%』必須來自實際執行 gate 的輸出；沒跑就說 not verified yet。」並要求 state-aware 檢查（hover/focus/active 的真實 computed contrast）、responsive gate（280/320/414px 無水平溢出）、以及「gates 證明客觀正確性、不證明主觀美感——美感交給 taste audit + 人類 review」的誠實範圍聲明。
- 資產：DTCG design tokens、42 components、WCAG 2.2 對照、138 design systems crosswalk、frameworks adapter protocol（React/SwiftUI/Flutter…按需生成 adapter）。
- 對 AgentTeam：這份協定幾乎是 ADR-0048 的設計域表述。SubDesign Critique 目前的四項分數（briefCoverage 等）若非由 gate 產出，就是 model-attested——把這些 gates 包成 Pi Core tools / EvidenceProvider，是讓 critique verdict 拿到 execution evidence 的最短路径。

### rohitg00/awesome-claude-design（窗外參考）

[README](https://raw.githubusercontent.com/rohitg00/awesome-claude-design/main/README.md)。2026-04-23 後無推送（超出門檻），~1.1k stars，MIT。28+ 份按美學家族整理的 `DESIGN.md`（Linear/Ollama/Claude/ClickHouse…），附 remix recipes。它存在的意義是市場證據：**DESIGN.md 已經是社群流通的內容格式**。SubDesign 移除內部 Design System 後，若要用戶仍想「帶入品牌約束」，正確姿勢是把這類檔案當外部內容經 ReferenceImportPanel/catalog 匯入 brief constraints，而不是重建 picker。

### Watchlist（相關但非 design-agent 核心）

- [gptme/gptme](https://github.com/gptme/gptme)：MIT、4.4k stars、master 2026-08-20 仍在推送。terminal agent harness（含 browser tool），非 design 專用；作為 harness 模式觀察即可。
- [srcbookdev/srcbook](https://github.com/srcbookdev/srcbook)：TypeScript notebook + AI app builder、Apache-2.0、3.4k stars。其 notebook 執行模型與 SubDesign 無直接重疊。
- [refly-ai/refly](https://github.com/refly-ai/refly)：canvas 式 AI workflow、7.5k stars；授權為 Apache-2.0 加額外條款（自稱 ReflyAI Open Source License，[LICENSE](https://raw.githubusercontent.com/refly-ai/refly/main/LICENSE) 開頭即列 personal/commercial 使用條件），引用前需細讀。與 SubDesign 重疊度低。
- [bolt.diy](https://github.com/stackblitz-labs/bolt.diy)（窗外）：WebContainer in-browser full-stack runtime 的最大開源樣本；main 分支 2026-02 後趨緩。注意其 license 頁自認：code 是 MIT 但 **WebContainers API 商用需授權**——任何「借它的 runtime」想法都有商業授權風險，esbuild-wasm/esm.sh 路線無此問題。

---

## 1. 整合分析與缺口（vs AgentTeam）

AgentTeam 既有的底盤在前次報告已確認：Pi Core supervised utility process、`runTask` 單一入口、tool registry、五階段生命週期（`app/src/agent/subdesign/types.ts` 的 `SubDesignStage`）、versioned artifact manifest + renderer registry + export pipeline、`streamingEnvelope.ts`、MCP Apps sandboxed surface（`McpAppSurface.tsx`）、Critique theater（panelists/rounds/evidence 含 `sha256`）、Approval Mode、encrypted connector vault、plugin trust/snapshot/admission。**這批 clone 沒有任何一個在「執行治理」（單一入口、fail-closed admission、execution evidence）上比 AgentTeam 更嚴謹**——Dyad 的安全文件甚至反過來印證了同構的設計（腳本不是邊界、host policy 才是）。

具體缺口，按證據強度排列：

1. **交付後 review 迴路不存在**（Glance、Open Artifacts）。AgentTeam 的 artifact 生命週期止於 export record；沒有「可留言的表面 → 結構化留言 → agent 經 `runTask` 讀取並 scoped 修正」的閉環。Glance 證明這個迴路可以完全 CLI/文字正規化，不需要雲端智能。
2. **指向式回饋缺失**（Open CoDesign Comment mode、Onlook 元素反查）。ArtifactTweakPanel 是模型預先宣告的 find/replace tweaks；使用者無法點擊渲染元素說「這裡改」，也無法從元素反查 artifact 內部結構。
3. **Critique 分數的 evidence 地位未閉合**（ux-ui-agent-skills、Open CoDesign rubric）。`SubDesignCritiqueEvidence` 已有 `kind: 'lint' | 'build' | ...` 與 `sha256`，但四項 score 本身仍可能源自模型敘述。「gate 沒跑就不能報分數」應成為 Critique stage 的 type-level 約束。
4. **react-component 的可執行預覽契約不明**（Open CoDesign、LlamaCoder、fragments 提供三種已驗證路徑）。HTML artifact 有 renderer，react-component 的 live bundling 故事（離線 vendored runtime？esm.sh？）未有對應文件。
5. **迭代歷史的操作面薄弱**（Dyad git checkpoints、Onlook branching、Open Artifacts immutable versions + baseVersion 409）。`revision` 欄位存在，但 restore/diff/side-by-side 的使用者操作與衝突語意未見。
6. **UI 層延伸點**（Boring UI `boring.*`）。Extension Packs 覆蓋 agent 層，panels/commands/catalogs 這類宣告式 UI 延伸尚無對等物；Boring UI 證明它能在不讓 renderer 持權限的前提下做到。
7. **evals 的 fixture 化**（Dyad engine fixtures、Open CoDesign BENCHMARKS.md）。SubDesign 缺少可模擬 tool call 序列的 stage-level regression fixtures。

AgentTeam 反而明顯更強的地方（不需追）：multi-run concurrency 治理與 `runId` isolation、Time-based/Proactive 的 typed trigger claim、Outbound Data Gate 與 Sanitized Workspace、external CLI 的 DoD fail-closed 語意、connector token 只住 main-process vault。上述 clone 全部沒有對等物；Dyad 甚至把「全 codebase 每次注入」當預設 context 策略。

## 2. 缺少的功能（清單）

以下功能 AgentTeam 目前完全沒有（以 `app/src/agent/subdesign/` 與 components listing 為準）：

1. **Artifact publish + 分享連結**（Glance/Open Artifacts）：任何形式的「部署到可檢視 URL」。
2. **瀏覽器/畫布內留言 thread**（Glance）：留言作為 artifact 的 first-class 資料、可被 agent 讀取。
3. **Region-pinned 修正指令**（Open CoDesign comment mode）：點元素 → pin → scoped rewrite。
4. **Deterministic design gates**（ux-ui-agent-skills）：contrast/state/responsive/token 一致性的腳本化檢查，產出可重現分數。
5. **Boolean parity rubric 迭代迴圈**（Open CoDesign Decompose to UI Kit）：passCount/totalChecks 的自查-迭代-誠實降分。
6. **Immutable version + 衝突偵測**（Open Artifacts）：`baseVersion` 式 409 語意、per-version metadata。
7. **Checkpoint/branch 操作**（Dyad/Onlook）：restore 到先前 revision、平行方向分支比較（Open CoDesign roadmap 也還沒做 three-style exploration——這是可搶先的差異點）。
8. **react-component live preview**（三方皆有）：離線或 CDN 的 in-sandbox bundle 執行。
9. **AI-emitted tweak parameters**（Open CoDesign `tweaks` tool）：由模型提議「值得調」的 slider 集合（AgentTeam 的 tweaks 是模板宣告，非模型 emit——依 types.ts 的 `SubDesignArtifactTweak` 結構判斷；此點若有遺漏以程式碼為準）。
10. **Stage-level eval fixtures**（Dyad）：模擬 tool call 引擎的 e2e 測試資產。

## 3. 符合使用者操作的功能與整合（P0/P1/P2）

排序原則：(a) 對應真實使用者工作流（設計師拿到稿 → 指著說哪裡改 → 驗收 → 分享）；(b) 必須能塞進 AgentTeam 的安全模型——所有執行走 `runTask`、證據不可由模型製造、renderer 不持 token、第三方內容必 sandbox。

### P0

**1. Critique verification gates（EvidenceProvider 化）**
把 contrast/WCAG state-aware/console-error/build-success/token-consistency 檢查實作為 Pi Core tools（或沿用前次報告的 `EvidenceProvider` 介面），gate 輸出寫入 `SubDesignCritiqueEvidence`（`kind: 'lint'|'build'` 已存在），並要求：**panelist 分數只能引用 gate 輸出，否則 verdict 不得為 pass**。理由：ux-ui-agent-skills 與 Open CoDesign 各自獨立收斂到同一做法；ADR-0048 已給了哲學地基，這只是把它在設計域落地。不需要任何新執行迴圈。

**2. Element-pinned comment → structured patch operation**
在 ArtifactPreview 的 sandboxed iframe 外層（host 端）加 pin 模式：pin 記錄元素 selector/區域座標 + 使用者文字，提交時組成一次 `runTask` build 迭代的結構化輸入（比照 `SubDesignArtifactPatchOperation` 的 find/replace 語意延伸為 scoped patch）。iframe 內容不可信，所以 pin 的 selector 解析必須由 host 注入的唯讀 script 完成、payload 經 schema validation——與 MCP Apps bridge 同一信任等級。

**3. Artifact revision snapshot / restore / diff**
在 workspace store 內為每個 revision 保存 entry+supportingFiles 快照（sha256 已在 types），提供 restore 與 side-by-side diff。純本機檔案操作，零安全模型衝擊；直接回應「AI 改壞了能不能退回」這個所有同類產品的最高頻使用者焦慮（Dyad/Onlook 都把它列為核心功能）。

### P1

**4. react-component 可執行預覽 contract**
採 Open CoDesign 路線：vendored React + Babel（或 esbuild-wasm）on-device，於 sandboxed iframe 執行，CSP 採 Open Artifacts 模式（`sandbox allow-scripts` + `default-src 'none'`，opaque origin、無外連）。明確排除 esm.sh/CDN 依賴路線，因為它與 Outbound Data Gate 及離線使用矛盾。renderer registry 新增 capability 欄位（`runtime: 'static' | 'bundled'`），沿用前次報告「新 renderer 必須宣告 sandbox policy」的規則。

**5. Local-first review threads**
Glance 的迴路去掉 Cloudflare：留言存 project-relative（比照 `SubDesignExportRecord` 的儲存模式），每則留言是一筆結構化資料（region + text + author + timestamp），Deliver/Critique stage 可把未處理留言併入下一次 `runTask` 的 prompt context。語音輸入若有，一律在入口轉文字（Glance 的 transcript-is-the-comment 原則）。分享到外部 URL 留給 P2。

### P2

**6. Self-hosted publish/share lane**
只有在 deployment policy 明確允許（Outbound Data Gate effective mode 非 mandatory protection）時出現的選配功能：把 artifact 發佈到使用者自己的 Cloudflare/靜態空間。加密採 Open Artifacts 的 client-side zero-knowledge 模式，金鑰不進 vault 以外的任何地方。工程量與政策審查都大，故置底。

**7. DESIGN.md / design-tokens 作為外部內容格式**
不重建內部 Design System。做法：在 ReferenceImportPanel 增加 `design-md`/DTCG tokens 檔案類型，匯入後成為 brief constraints 的 attributed 來源（`SubDesignReference.kind` 需擴充），內容經既有 catalog/trust 管線檢疫。生態已把 DESIGN.md 當流通格式（awesome-claude-design、Open CoDesign、open-artifacts skill 皆然），AgentTeam 當消費者即可。

**8. Stage-level eval fixtures**
比照 Dyad 的 `e2e-tests/fixtures/engine`，建立可重放的 tool-call 序列 fixtures，讓 brief→direction→build→critique 的 state machine 有 regression 測試。純測試基建。

### 明確不做

- 不引入 Dyad 的 XML-tag pseudo-tool-calling 或其 `src/pro` agent loop（FSL 授權且 AgentTeam 已有 Pi Core tool loop）。
- 不引入 E2B/WebContainer 等外部 runtime 作為硬依賴（雲端依賴與商用授權風險，見 bolt.diy license 註記）。
- 不因 Glance/Open Artifacts 而把 artifact 發佈做成預設路徑——分享永遠是 policy-gated 的 opt-in。
- 不 fork CopilotKit/AI SDK 作為第二 orchestration layer（維持前次報告結論）。

## 不確定事項

- 所有 `pushed_at` 以 default branch atom feed 最新 commit 為下界；其他 branch 的 push 不反映（例如 bolt.diy 若在其他 branch 有活動則未被計入）。
- Dyad 的 `src/pro`（fair-source）僅依官方 docs 描述，未逐行驗證其 local agent 行為。
- Glance/Open Artifacts/Boring UI 為低星新專案（31/46/45 stars），長期維護風險高，整合時應 pin commit 並以 vendor-pack 方式隔離。
- SubDesign 是否已有某些清單第 2、3 節功能的半成品，僅以目錄與 `types.ts` 判斷；實作前應以程式碼為準。
