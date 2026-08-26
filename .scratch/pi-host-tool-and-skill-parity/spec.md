# Pi Host tool and skill parity: one tool catalog, one resource loader

Status: resolved

> **對帳註記（2026-08-26，tracker-truth-reconciliation #03）**：本 spec 的問題陳述（「Host 只有 6 個 builtin tool / 3 個 capability」「技能在 localStorage 而 Host 沒有 skill 工具」「Settings 列的能力幾乎都叫不動」）描述的是**動工前的世界**，現已成歷史：十個 extension pack 已落地 `electron/piExtensionPacks/`、`pi.registerTool()` 與 `additionalSkillPaths` 接縫已通、`piTurnContext` 技能注入分支已整段移除（ADR-0034 衝突已解）、renderer 等價工具已刪。19/19 票驗收框全滿；gate 證據為主鏈上的 `smoke-pi-parity-qualification`。唯一刻意 `[~]`（hermes/skills.ts 唯讀回滾版本）見票 #18 與 INDEX known residuals。以下原文保留作為決策紀錄。

Status（原文）： 可交給代理

Source: 本 session 的排查（四題：對話互相污染／session 保存／request-response 顯示／工具與 skill 的 global 載入）。前三題與第四題的緊急止血已經 ship（`agentStore.publishRun` 選擇權、`piProduction` ownership 表、thread prefs sidecar、專案綁定順序、氣泡時序、`renderMarkdown`）。這份 spec 只擁有第四題的**終局**：讓 Pi Core Host 真的擁有 SubAgents 的工具目錄與技能，並移除為了止血而生的第二套 discovery。

**ADR 衝突（必須先讀）**：止血用的 `agent/piTurnContext.ts` 在 renderer 端用 Hermes `skillsStore` 解析技能、把 body 塞進 prompt。ADR-0034 明文規定 Pi 的 resource loader 是 skills / prompts / extensions / packages 的**唯一**進入點，legacy Hermes discovery 應在資源遷移與 parity 檢查後移除。`piTurnContext` 的技能路徑因此是一個**被本 spec 明確排定退場**的權宜措施，不是要保留的設計。它的專案指引與對話歷史部分不受此限（那不是 resource discovery）。

## Problem Statement

使用者在設定裡寫了一個技能，存檔，然後開一個新對話請 agent 做那件事。Agent 完全不知道那個技能存在。使用者再打開工具清單，看到 `web_search`、`http_fetch`、`memory_search`、`delegate_task`、`codegraph_explore` 等等一整排工具都列在那裡、都可以在設定裡勾選，但實際跑起來 agent 一個都叫不動。

原因不是任何一處壞掉，而是**產品有兩套工具系統，而出貨的那一套是空的**：

- Renderer 有 48 個自我註冊的工具（`agent/tools/registered/`）與 14 個 capability（`agent/capabilities/builtins.ts`），Settings 頁列的是它們。
- Electron production 實際執行的是 Pi Core Host，它只有 6 個 builtin tool（`bash` / `edit` / `find` / `grep` / `ls` / `read`）與 3 個 capability（`core-files` / `workspace-write` / `shell`）。
- 兩者之間沒有橋。Host 在獨立的 utility process，讀不到 renderer 的 localStorage，也沒有回呼 renderer 執行工具的路徑。`tools/list` 只回報 Pi builtin 加上 MCP extension 的工具。

同一個斷層讓技能整個消失：技能存在 renderer 的 `skillsStore`（localStorage），Host 沒有 `skill_list` / `skill_load`，`PiResourceRegistry`（`kind: 'skill'` 已在型別裡）從來沒有人填過，`resources/reload` 沒有任何呼叫端。

更糟的是**它不會報錯**。Settings 顯示工具已啟用，技能列表顯示技能存在，run 正常結束，只是 agent 從頭到尾沒有那些能力。使用者唯一能觀察到的是「agent 好像變笨了」，沒有任何訊息告訴他為什麼。

而 Pi Core 其實**早就原生支援這兩件事**，只是沒被接上：

- `piCodingAgent.DefaultResourceLoader` 已經在 `piCoreRuntime.ensurePiSessionRuntime` 被建立並 `reload()`，還已經掛了一個 hidden extension factory（`subagents-session-context`）。它接受 `additionalSkillPaths` 與 `skillsOverride`。
- Pi 的 `agent-session` 把 `resourceLoader.getSkills().skills` 放進 `_baseSystemPromptOptions.skills`，`formatSkillsForPrompt` 會渲染成 `<available_skills>`（name / description / **location**），並指示模型用 `read` 工具載入該檔。`/skill:<name>` 可就地展開 body。`disable-model-invocation` 對應 SubAgents 的 `status: 'archived'`。
- Pi extension API 提供 `pi.registerTool({ name, description, promptSnippet, promptGuidelines, parameters, execute })` 與 `pi.setActiveTools([...])` + Dynamic Tool Loading —— 正是 ADR-0028 所指的 progressive disclosure 機制。

也就是說，缺的不是能力，是接線。

## Solution

Pi Core Host 成為工具與技能的唯一擁有者，renderer 退回純粹的 UI Projection。

**工具**：SubAgents 那些沒有 Pi builtin 對應物的工具，改以 `pi.registerTool()` 在 Host 內註冊成 Pi extension tools，依 CONTEXT.md 的 Extension Pack 邊界分組。與 Pi builtin 行為等價的（`workspace_read`/`workspace_list`/`workspace_grep`/`workspace_glob`/`workspace_write`/`bash`）依 ADR-0027 **移除**而非別名保留，且移除前要有 parity 測試。progressive disclosure 從 renderer 的 capability runtime 搬到 Host 的 Capability Extension，用 Pi 自己的 active-tool 控制實作（ADR-0028）。

**技能**：技能改由 Pi 的 resource loader 探索。使用者的技能以 `SKILL.md` + frontmatter 寫到 Host 擁有的技能目錄，`DefaultResourceLoader` 的 `additionalSkillPaths` 指向它。既有 localStorage 技能一次性遷移到磁碟，遷移完成且 parity 檢查通過後，`hermes/skills.ts` 與 `piTurnContext` 的技能注入一併刪除（ADR-0034）。

**使用者可見的差別**：Settings 列出的工具就是實際可用的工具；技能寫了就生效；勾選 / 取消勾選會真的改變 agent 的行為；某個工具在這次 run 不可用時，使用者看得到原因。

## User Stories

1. As a SubAgents user, I want the tools listed in Settings to be the tools the agent can actually call, so that the list is a description of reality rather than a menu that does nothing.
2. As a SubAgents user, I want a skill I wrote in Settings to be visible to the agent on the next run, so that the effort of writing it is not silently discarded.
3. As a SubAgents user, I want the agent to load a skill's full instructions when the task matches its description, so that I do not have to paste the procedure into every message.
4. As a SubAgents user, I want a pinned skill to apply whether or not my wording happens to match its keywords, so that pinning means something.
5. As a SubAgents user, I want an archived skill to stay out of the agent's context while remaining recoverable, so that retiring a skill is not the same as deleting it.
6. As a SubAgents user, I want `web_search` and `http_fetch` to work in the desktop app, so that research tasks are not silently downgraded to guesswork.
7. As a SubAgents user, I want `memory_set` / `memory_get` / `memory_append` / `memory_search` to reach one memory store, so that what the agent remembers in one run is what it recalls in the next.
8. As a SubAgents user, I want `delegate_task` and `delegate_status` to work, so that sub-agent delegation is a real feature rather than a listed one.
9. As a SubAgents user, I want the `codegraph_*` tools to reach the same graph the app indexes, so that structural questions get structural answers.
10. As a SubAgents user, I want `update_plan` to drive the plan panel I can see, so that the agent's plan and the UI's plan are the same plan.
11. As a SubAgents user, I want `ask_user` to raise the same HITL prompt as any other approval, so that a question from the agent reaches me instead of stalling the run.
12. As a SubAgents user, I want the `design_*` tools available inside a SubDesign run, so that the design workflow works in the shipped app.
13. As a SubAgents user, I want `mcp_list_tools` / `mcp_call` to reach the MCP servers I configured, so that my MCP setup is usable from the agent loop.
14. As a SubAgents user, I want a tool that is unavailable this run to say so, so that I can tell "the agent chose not to" apart from "the agent could not".
15. As a SubAgents user, I want progressive disclosure to still hide unloaded capability schemas behind one catalog line, so that the context budget is not spent on tools this task will never use.
16. As a SubAgents user, I want `load_capability` to reveal a capability's tools and runbook mid-run, so that a task that turns out to need a capability can pick it up without restarting.
17. As a SubAgents user, I want the capabilities loaded in my last run on this conversation to be preloaded in the next, so that a follow-up does not re-discover what the thread already established.
18. As a SubAgents user, I want `tool_search` to keep working past the tool-count threshold, so that a large catalog stays navigable.
19. As a SubAgents user, I want `run_code` to call the same tools through the same approval gate, so that Code Mode is not a way around approvals.
20. As a SubAgents user, I want every extension tool to go through the same Approval Decision as a builtin, so that "代我核准" and "要求核准" mean one thing across the whole catalog.
21. As a SubAgents user, I want a tool that mutates files to participate in the same per-file queue as `edit` and `write`, so that two tools touching one file in a turn cannot lose my changes.
22. As a SubAgents user, I want a cancelled run to stop its in-flight extension tool at a tool boundary, so that stopping is safe rather than abrupt.
23. As a SubAgents user, I want every extension tool call recorded in the Turn Record with its own coordinates, so that a finished run can be inspected the same way builtin calls can.
24. As a SubAgents developer, I want one place that defines a tool, so that adding one does not mean writing it twice and keeping two copies in step.
25. As a SubAgents developer, I want the tool catalog exposed over the Pi Host Protocol, so that the renderer's tool list is a projection instead of an independent source of truth.
26. As a SubAgents developer, I want tools that duplicate a Pi builtin removed rather than aliased, so that there is one implementation of reading a file (ADR-0027).
27. As a SubAgents developer, I want a contract test proving parity before a legacy tool is deleted, so that removal is evidence-backed rather than hopeful.
28. As a SubAgents developer, I want skills discovered only by Pi's resource loader, so that there is one precedence and one reload path (ADR-0034).
29. As a SubAgents developer, I want the renderer's `piTurnContext` skill injection deleted once Host-side skills land, so that the stopgap does not calcify into a second discovery system.
30. As a SubAgents developer, I want a drift guard that fails the build if a new renderer-side tool registration appears, so that the two-catalog split cannot silently return.
31. As a SubAgents user upgrading from a previous version, I want my existing skills migrated to the new location automatically, so that upgrading does not lose work.
32. As a SubAgents user, I want the migration to report what it moved and what it could not, so that a partial migration is visible rather than assumed.
33. As a SubAgents user, I want the app to fail closed if the Host cannot expose the tool catalog, so that I am told the catalog is unavailable instead of getting a quietly reduced agent.
34. As a SubAgents user in a plain browser, I want the app to keep working with whatever it has, so that the browser-only compatibility seam still degrades gracefully.
35. As a SubAgents user, I want the Outbound Data Gate to apply to extension tools exactly as it does to builtins, so that a new tool cannot become a new egress path.
36. As a SubAgents user with a Restricted Project View pinned, I want extension tools bound to that view, so that protection holds across the whole catalog.

## Implementation Decisions

**One catalog, owned by the Host.** Tool definitions move into the Pi Core Host and are registered through `pi.registerTool()` inside Host-owned extension factories, passed to `DefaultResourceLoader` alongside the existing `subagents-session-context` factory. Pi Core stays the sole tool loop and the sole source of tool definitions (ADR-0028). No central executor switch is added on either side.

**Extension Pack grouping.** Tools group by the cohesive boundaries CONTEXT.md already names — Orchestration, Policy, Capabilities, Memory, Automation, Integrations, Marketplace — rather than one flat extension. Each pack is a Trusted Extension in ADR-0024 terms: full host authority, enablement is an explicit trust decision, and no UI copy may describe a pack as sandboxed or permission-limited.

**Equivalence is removal, not aliasing.** `workspace_read` → `read`, `workspace_list` → `ls`, `workspace_grep` → `grep`, `workspace_glob` → `find`, `workspace_write` → `write`, `bash` → `bash`. Each is deleted only after a contract test proves parity across parameter schema, success and error results, streaming updates, cancellation, project scope, and session recording (ADR-0027). Anything unmatched — `workspace_diff`, `workspace_move`, `workspace_delete`, `workspace_mkdir`, `workspace_download` — becomes a separately named extension tool rather than being folded into a builtin.

**Progressive disclosure moves to Pi's own controls.** The Host's `PiCapabilityCatalog` gains the renderer's 14 capability definitions and drives `pi.setActiveTools([...])` plus Dynamic Tool Loading. `load_capability`, `tool_search` and `run_code` stay reserved names. Per-thread persistence of loaded capability ids and unlocked tools stays a renderer preference (it already survives restart via the thread prefs sidecar) but the authority on what is active in a turn is the Host.

**Skills become Pi resources.** A Host-owned skills directory holds one `SKILL.md` per skill with `name` / `description` frontmatter; `disable-model-invocation` carries the archived state. `DefaultResourceLoader` receives the directory through `additionalSkillPaths`. Pi's `formatSkillsForPrompt` then advertises them and the model loads a body with `read` — which means **the `read` tool must be active for skills to be visible at all**, and that dependency has to be explicit rather than discovered in the field. Pinned skills are the one case Pi's catalog-only advertisement does not cover; they are handled by expanding the body up front, the way `/skill:<name>` already does, not by a second discovery path.

**Migration is one-way and reported.** On first run of the new build, skills in the renderer `skillsStore` are written to the skills directory, a per-skill result is recorded, and the localStorage copy is retained read-only for one release as a rollback. `PiResourceRegistry` is populated from the loader's `getSkills()` so `resources/list` finally describes reality. `hermes/skills.ts`, the `skill_list` / `skill_load` / `skill_save` renderer tools, and the skill branch of `piTurnContext` are deleted in the same ticket that proves parity — not before, and not left behind.

**Protocol shape.** `tools/list` becomes the single catalog projection: Pi builtins, extension-pack tools, and MCP tools, each with the id, owning pack, and whether it is active this turn. The renderer's Settings page reads that projection instead of `toolDefinitions.ts`. Adding a protocol method or changing a payload shape follows ADR-0038's versioning.

**The catalog is a union of two discovery paths, not one switched source.** A tool reaches the catalog either because the Host discovered it (built-in packs, Pi's resource loader) or because the user installed it (an MCP server, an extension pack they enabled). Settings shows both in one list, and availability is a fact carried by each entry with its own reason — never a wholesale state where everything the Host has not adopted yet greys out at once. This matters for the migration itself: while packs are still landing, an entry that is not yet Host-provided says exactly that, beside entries that are live. Showing what the user installed is in scope; building the Marketplace install flow is not (see Out of Scope).

**Approval, egress and evidence are not re-implemented per tool.** Extension tools go through the existing Approval Decision composition, the Outbound Data Gate, the Restricted Project View binding, and the Turn Record. A tool that mutates files uses Pi's `withFileMutationQueue()` so it shares the per-file queue with `edit` and `write`. Cancellation lands on a tool boundary, matching the existing `toolsInFlight` park logic.

**Fail closed.** If the Host cannot produce a catalog, the app says so. It must not fall back to the renderer catalog — that fallback is the two-system problem restated.

## Testing Decisions

**What a good test is here.** Only externally observable behavior: what the Pi Host Protocol answers, and what a turn actually does. Never the shape of an internal registry, never a private method's arguments. A test that would still pass if the tool never executed is not a test of this feature.

**One seam: the Pi Host Protocol over stdio.** Tests spawn the shipped `dist-electron/pi-host.js` with a temp `SUBAGENTS_PI_HOST_STATE_PATH` and drive real requests, exactly as `scripts/smoke-pi-host-capabilities.mts` already does. This is the highest available seam and it already exists, so no new seam is introduced. It also satisfies the repo rule that smokes import the shipped modules: green means the shipped path is correct.

**Prior art to follow.**
- `scripts/smoke-pi-host-capabilities.mts` — spawn-and-drive protocol harness, `initialize` → `capabilities/list` → `capabilities/load` → error case. The template for every test here.
- `scripts/smoke-pi-equivalent-tools.mts` — project-scope and contract assertions on the equivalent tools, including the escape-the-root rejection. The template for ADR-0027 parity proofs.
- `scripts/smoke-pi-capabilities.mts` — deterministic assertions on the shipped catalog module.
- `scripts/smoke-record-fidelity-qualification.mts` — the end-to-end qualification pattern for a whole effort.

**What gets asserted at that seam.**
- `tools/list` returns the full catalog, each entry naming its owning pack and active state.
- Each extension tool executes and returns its result; a failing one returns a structured failure rather than throwing.
- An inactive tool is refused with a reason, and the reason reaches the caller.
- `capabilities/load` reveals a pack's tools and runbook mid-turn, and `tools/list` changes accordingly.
- Approval: a tool requiring approval is refused without one and proceeds with one, under each Approval Mode, including the unattended downgrade.
- Cancellation during an in-flight extension tool parks at a tool boundary.
- The Turn Record contains a `tool-call` / `tool-result` pair per extension call with correct coordinates.
- `resources/list` reflects the skills the loader found; an archived skill is absent from the advertised set and present in the registry.
- A turn's system prompt advertises the migrated skills, and a skill body is reachable by the path the catalog gave.
- Migration: a fixture localStorage payload produces the expected files plus a per-skill report, and a malformed skill is reported rather than dropped.
- Parity, per removed tool: same parameter schema, same success shape, same error shape, same project-scope rejection.

**Drift guards** (source-text guards over the shipped tree, the existing house pattern): a new file under `agent/tools/registered/` fails the build; a new import or string reference to `hermes/skills.ts` fails the build; the skills branch of `piTurnContext` must be gone by the migration ticket.

## Out of Scope

- **跨 session 召回的專案隔離**（本 session 排查的 1C）。`searchSessions` 掃全域 archive + memory + skills，`ArchiveRecord` 連 project 欄位都沒有。要做需要加欄位、改寫入端、遷移既有資料，且依 ADR-0035 應落在 Memory Extension。另開 effort。
- **已 ship 的四項修復**（run 選擇權、thread prefs sidecar、專案綁定順序、氣泡時序、`renderMarkdown`）。它們已在本 session 完成並通過 build + smoke，這份 spec 不重述。
- **`piTurnContext` 的專案指引與對話歷史注入**。那不是 resource discovery，不受 ADR-0034 管；是否改由 Host 的 `getAgentsFiles()` 供應是另一個決定。
- **Pi 上游同步**。`vendor/pi` 的變更走 ADR-0043 / 0044 的 Core Patch Ledger 與 gated PR。
- **Marketplace 安裝流程**與外掛 OAuth。
- **plain-browser fallback 的功能對等**。ADR-0046 已定產品為 Electron-only；browser 路徑只需優雅降級。

## Further Notes

- 本 spec 的 problem statement 全部有實據：工具數（renderer `agent/tools/registered/` 48 個、`capabilities/builtins.ts` 14 個 capability；Host `piCoreRuntime.TOOL_FACTORIES` 6 個、`piCapabilityExtension.DEFAULT_PI_CAPABILITIES` 3 個）、`resources/reload` 無呼叫端、`skill_list` 在 `electron/` 不存在，皆可直接查證。
- Pi 端可用的接點也全部確認過：`DefaultResourceLoader` 的 `additionalSkillPaths` / `skillsOverride`、`agent-session` 的 `getSkills()` → `_baseSystemPromptOptions.skills`、`formatSkillsForPrompt` 的 `<available_skills>` 輸出、`pi.registerTool()` / `pi.setActiveTools()` / Dynamic Tool Loading。這個 effort 是接線，不是新造能力。
- **`read` 與技能的耦合值得在拆票時獨立處理**：`formatSkillsForPrompt` 只在 `read` 工具可用時被附加。若某個 capability 組態關掉了 `read`，技能會整批靜默消失——正是本 spec 要消滅的那種失敗模式。
- 拆票時建議把 ADR-0027 的每個 parity 證明各自成票，因為每一張都是刪除授權，證據不足就不該合併。
