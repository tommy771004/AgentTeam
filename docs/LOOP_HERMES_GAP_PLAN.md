# Loop Engine × Hermes 核心缺口 — 修改計畫（第七輪稽核產物）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Loop Engine 的「Process / Validate」兩端從啟發式／模擬升級為 LLM 驅動（LLM 解析計畫、DoD 語意驗收、迭代回饋），並補齊 Hermes 學習層的相關性召回與失敗學習，使四種 Loop 模式真正符合 `docs/01~03` 規格。

**Architecture:** 不動既有執行管線（runTask → dispatchThreadTask → agentEngine → FC/heuristic/simulation 三路徑）。新增兩個純函式為主的模組（`llmParser.ts`、`dodEvaluator.ts`），engine 在「解析後」與「迭代 DoD 檢查」兩個點呼叫，LLM 失敗一律回退現行啟發式（模擬模式零退化）。Hermes 側只擴充既有 store 的函式簽名，不新增 store。

**Tech Stack:** TypeScript（app/，React 19 + zustand）、驗證 = `npm run build`（typecheck）+ `npm run smoke`（smoke-caps.mjs 鏡射純邏輯 + source-contract 檢查）。無單元測試框架 — 測試一律加在 `app/scripts/smoke-caps.mjs`。

---

## 稽核背景（2026-07-11 第七輪）

前六輪（`WORKFLOW_AUDIT.md`）已覆蓋工作流呼應、自動載入/帶入、工具庫、approvalMode，全數驗證通過。本輪聚焦使用者問題 4：**loop engineering 與 hermes agent 兩類核心是否完整、且真正用於任務執行**。

已驗證為完整且接線正確（無需修改）：

| 面向 | 錨點 |
|---|---|
| 四種 Loop 模式皆實作且由統一管線觸發 | `engine.ts:437-450`、`runExternal.ts:416-421` |
| Hermes promptBuilder（soul/技能索引/記憶/外掛片段）用於 FC + heuristic + delegate 三路徑 | `engine.ts:657,1049`、`delegate.ts:131` |
| 學習迴圈四模式成功後皆觸發；CLI 路徑也回流 | `engine.ts:1234,1356,1432`、`agentStore.ts:488` |
| 委派隔離（budget/blockedTools/preload）+ 背景委派入 Archive | `delegate.ts`、`executor.ts:317`、`App.tsx:244` |
| 意圖 preload v2（builtin+skill+plugin/MCP+專案包，secret 加權） | `intentPreload.ts` → `runDispatch.ts:117,238` |

本輪缺口（本計畫的 Task 對應）：

| # | 缺口 | 嚴重度 | Task |
|---|---|---|---|
| G-A | **DoD 驗收非語意**：Goal-based 只檢查「步驟全完成 + 合成信心分數」（`engine.ts:1137-1139,1284-1291`），信心分數 = `0.55+迭代*0.08+步序*0.18+隨機`，與輸出品質無關。規格 02 Pattern 2 要求「Agent self-evaluates against the DoD」 | ★★★ | 1 |
| G-B | **解析器是罐頭模板**：`parser.ts` 步驟固定五段（Data Ingestion…），DoD 取第一個數字（「分析 2025 年趨勢」→「exactly 2025 items」誤判），GOAL 關鍵字純英文；且 dispatch 永遠 forceLoopType（`runExternal.ts:271` 預設 Goal-based），自動分類實際死碼。規格 03 要求 MUST parse | ★★★ | 2 |
| G-C | **迭代不修正**：DoD 未達時只把非完成步驟重設 PENDING（`engine.ts:1308-1310`）；若步驟全完成但 DoD 未達 → 下一輪 0 步驟空轉直到 max。無「缺什麼補什麼」回饋 | ★★ | 3 |
| G-D | **記憶召回與目標無關**：volatile 層只帶「最近 5 條 + MEMORY 文件切片」（`memory.ts:91-113`）；`memoryStore.search` 只有 `memory_search` 工具在用 | ★★ | 4 |
| G-E | **失敗不學習**：`learningLoop` 只有 onGoalSuccess；max-iterations 失敗、全工具失敗都不留教訓，違反 Hermes「避免重複犯錯」哲學 | ★★ | 5 |
| G-F | **Turn-based 無人值守會永久掛起**：`runTurnBased` 無條件 `waitForUser()`（`engine.ts:1227`）且無 timeout。目前排程 UI 不會設 Turn-based，屬防禦性修補（`ScheduledJob.loopType: LoopType` 型別允許） | ★ | 6 |
| G-G | **技能/意圖匹配對中文近乎失效**：`matchForObjective` 用「>3 字元的空白分詞」，中文無空白分詞永不命中；`intentPreload.scoreHay` 同型問題 | ★ | 7 |
| G-H | **文件漂移**：規格檔已移到 `docs/` 但根目錄版已刪除、`CLAUDE.md` 仍指根目錄 `01_…`；`ai_agent_loop_*` mock 已刪仍被引用 | 文件 | 8 |

建議實作順序 = Task 編號順序（Task 3 依賴 Task 1；其餘獨立）。

---

### Task 1: DoD 語意驗收器（`dodEvaluator.ts`）

**Files:**
- Create: `app/src/agent/dodEvaluator.ts`
- Modify: `app/src/agent/engine.ts:1284-1291`（runGoalBased 的 DoD 檢查）
- Test: `app/scripts/smoke-caps.mjs`（鏡射 `parseDodVerdict` + source contract）

- [ ] **Step 1: 在 smoke-caps.mjs 先寫鏡射測試（會失敗——source contract 找不到新檔）**

在 `app/scripts/smoke-caps.mjs` 既有測試群後追加（沿用檔內 `test(name, fn)` 慣例）：

```js
// ── DoD semantic evaluator (Task 1) ──────────────────────────
// Mirror of app/src/agent/dodEvaluator.ts parseDodVerdict
function parseDodVerdict(raw) {
  const text = (raw || '').trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    if (typeof obj.met !== 'boolean') return null
    const confidence =
      typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
        ? Math.max(0, Math.min(1, obj.confidence))
        : obj.met ? 0.85 : 0.4
    const missing = Array.isArray(obj.missing)
      ? obj.missing.filter((m) => typeof m === 'string' && m.trim()).slice(0, 8)
      : []
    return { met: obj.met, confidence, missing }
  } catch {
    return null
  }
}

await test('DoD verdict: plain JSON parses', () => {
  const v = parseDodVerdict('{"met": false, "confidence": 0.3, "missing": ["缺第三個工具"]}')
  assert.equal(v.met, false)
  assert.equal(v.confidence, 0.3)
  assert.deepEqual(v.missing, ['缺第三個工具'])
})

await test('DoD verdict: fenced JSON + prose parses', () => {
  const v = parseDodVerdict('好的，判定如下：\n```json\n{"met": true, "confidence": 1.4}\n```')
  assert.equal(v.met, true)
  assert.equal(v.confidence, 1) // clamp to [0,1]
  assert.deepEqual(v.missing, [])
})

await test('DoD verdict: non-JSON / missing met → null', () => {
  assert.equal(parseDodVerdict('我覺得應該完成了'), null)
  assert.equal(parseDodVerdict('{"confidence": 0.9}'), null)
})

await test('DoD verdict: missing[] filters non-strings and caps at 8', () => {
  const v = parseDodVerdict(
    `{"met": false, "missing": [1, "", "a","b","c","d","e","f","g","h","i"]}`,
  )
  assert.equal(v.missing.length, 8)
  assert.equal(v.confidence, 0.4) // default when absent + met=false
})

await test('source contract: engine Goal-based uses evaluateDoD', () => {
  const fs = require('node:fs')
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.ok(src.includes("from './dodEvaluator'"), 'engine must import dodEvaluator')
  assert.ok(src.includes('evaluateDoD('), 'runGoalBased must call evaluateDoD')
})
```

> 注意：檔內其他測試用 `const fs = await import('node:fs')`，照該慣例寫（上例 `require` 改為 `const fs = (await import('node:fs')).default`）。

- [ ] **Step 2: 跑 smoke 確認新增測試失敗**

Run: `cd app && npm run smoke`
Expected: `✗ source contract: engine Goal-based uses evaluateDoD`（鏡射測試綠、contract 紅）

- [ ] **Step 3: 建立 `app/src/agent/dodEvaluator.ts`**

```ts
/**
 * DoD 語意驗收 — 規格 02 Pattern 2:
 * "Agent self-evaluates against the DoD. Iterates if FALSE."
 * LLM 判定 stepOutputs 是否滿足 definitionOfDone；不可用時由呼叫端回退啟發式。
 */

import { chatCompletion } from './llm'
import type { LlmSettings } from './types'

export interface DodVerdict {
  met: boolean
  confidence: number
  missing: string[]
  tokensUsed: number
}

/** Pure: 解析 LLM 回傳的 JSON 判定（容忍 ```json 圍欄與前後贅語）。 */
export function parseDodVerdict(
  raw: string,
): Omit<DodVerdict, 'tokensUsed'> | null {
  const text = (raw || '').trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as {
      met?: unknown
      confidence?: unknown
      missing?: unknown
    }
    if (typeof obj.met !== 'boolean') return null
    const confidence =
      typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
        ? Math.max(0, Math.min(1, obj.confidence))
        : obj.met
          ? 0.85
          : 0.4
    const missing = Array.isArray(obj.missing)
      ? obj.missing
          .filter((m): m is string => typeof m === 'string' && !!m.trim())
          .slice(0, 8)
      : []
    return { met: obj.met, confidence, missing }
  } catch {
    return null
  }
}

export async function evaluateDoD(
  settings: LlmSettings,
  objective: string,
  definitionOfDone: string,
  stepOutputs: string[],
): Promise<DodVerdict> {
  const evidence = stepOutputs.slice(-6).join('\n---\n').slice(0, 9000)
  const r = await chatCompletion(
    settings,
    [
      {
        role: 'system',
        content:
          '你是驗收代理（Validator）。根據 Definition of Done 逐項檢查執行輸出是否達標。' +
          '嚴格但務實：證據不足視為未達成；部分達成也算未達成（規格禁止 partial-met 即終止）。' +
          '只輸出 JSON：{"met": true|false, "confidence": 0~1, "missing": ["未達成的具體缺口", ...]}',
      },
      {
        role: 'user',
        content: `目標：${objective}\n\nDefinition of Done：${definitionOfDone}\n\n執行輸出（近 6 步）：\n${evidence || '（無輸出）'}`,
      },
    ],
    { temperature: 0, maxTokens: 400 },
  )
  const verdict = parseDodVerdict(r.content)
  if (!verdict) {
    throw new Error(`DoD verdict unparsable: ${r.content.slice(0, 120)}`)
  }
  return { ...verdict, tokensUsed: r.tokensUsed }
}
```

- [ ] **Step 4: 接線 engine.ts（runGoalBased 的 DoD 檢查段）**

`app/src/agent/engine.ts` 頂部 import 區加：

```ts
import { evaluateDoD } from './dodEvaluator'
```

把現行（engine.ts:1284-1291）：

```ts
      const allDone = this.state.steps.every((s) => s.status === 'COMPLETED')
      const confidenceOk = this.state.confidence >= this.minConfidence()
      const dodMet = allDone && confidenceOk

      this.log(
        'EVAL',
        `DoD check: steps=${allDone}, confidence=${this.state.confidence.toFixed(2)} (≥${this.minConfidence().toFixed(2)}) → ${dodMet}`,
      )
```

改為（`missing` 供 Task 3 的迭代回饋使用；本 Task 先宣告）：

```ts
      const allDone = this.state.steps.every((s) => s.status === 'COMPLETED')
      let dodMet = allDone && this.state.confidence >= this.minConfidence()
      let missing: string[] = []

      // 規格 02 Pattern 2：LLM 對 DoD 語意自評；失敗回退啟發式（模擬模式不變）
      if (allDone && this.useLlm()) {
        try {
          const verdict = await evaluateDoD(
            withRoleModel(this.settings, 'analyst'),
            this.state.objective,
            this.state.loopConfig.definitionOfDone,
            this.stepOutputs,
          )
          dodMet = verdict.met
          missing = verdict.missing
          this.state.confidence = verdict.confidence
          this.state.tokensUsed += verdict.tokensUsed
          this.state.metrics.apiCredits = this.state.tokensUsed
          this.log(
            'EVAL',
            `DoD 語意驗收：met=${verdict.met} confidence=${verdict.confidence.toFixed(2)}` +
              (missing.length ? ` · 缺口：${missing.join(' | ').slice(0, 300)}` : ''),
          )
        } catch (e) {
          this.log(
            'WARN',
            `DoD 語意驗收失敗，回退步驟/信心啟發式：${e instanceof Error ? e.message : e}`,
          )
        }
      }

      this.log(
        'EVAL',
        `DoD check: steps=${allDone}, confidence=${this.state.confidence.toFixed(2)} (≥${this.minConfidence().toFixed(2)}) → ${dodMet}`,
      )
```

（`withRoleModel` 已在 engine.ts import。）

- [ ] **Step 5: 驗證**

Run: `cd app && npm run build && npm run smoke`
Expected: build 零錯誤；smoke 全綠（含 Step 1 的 5 個新測試）

- [ ] **Step 6: Commit**

```bash
git add app/src/agent/dodEvaluator.ts app/src/agent/engine.ts app/scripts/smoke-caps.mjs
git commit -m "feat(engine): LLM semantic DoD validation for Goal-based loop (spec 02 pattern 2)"
```

---

### Task 2: LLM 任務解析器（規格 03 完整實作）+ 啟發式解析器修補

**Files:**
- Create: `app/src/agent/llmParser.ts`
- Modify: `app/src/agent/parser.ts`（抽出 `buildParseResult`、中文 GOAL 關鍵字、DoD 數字 regex）
- Modify: `app/src/agent/engine.ts`（parse 後 LLM 精煉）
- Modify: `app/src/agent/types.ts` + `app/src/agent/llm.ts` + `app/src/pages/SettingsPage.tsx`（`llmParseEnabled` 三處齊改）
- Test: `app/scripts/smoke-caps.mjs`

- [ ] **Step 1: smoke 鏡射測試（先寫，contract 部分會失敗）**

```js
// ── LLM plan parser (Task 2) ─────────────────────────────────
// Mirror of app/src/agent/llmParser.ts parseLlmPlan (validation core)
function parseLlmPlanMirror(raw, forceLoopType) {
  const LOOP_TYPES = ['Turn-based', 'Goal-based', 'Time-based', 'Proactive']
  const match = (raw || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    const loopType =
      forceLoopType ||
      (LOOP_TYPES.includes(obj.loopType) ? obj.loopType : 'Goal-based')
    const steps = Array.isArray(obj.steps)
      ? obj.steps.filter((s) => typeof s === 'string' && s.trim()).slice(0, 7)
      : []
    if (steps.length < 2) return null
    const dod =
      typeof obj.definitionOfDone === 'string' && obj.definitionOfDone.trim()
        ? obj.definitionOfDone.trim().slice(0, 400)
        : ''
    if (!dod) return null
    const maxIterations =
      typeof obj.maxIterations === 'number' && obj.maxIterations >= 1
        ? Math.min(8, Math.round(obj.maxIterations))
        : loopType === 'Goal-based' ? 5 : 1
    return { loopType, steps, dod, maxIterations }
  } catch {
    return null
  }
}

await test('LLM plan: valid JSON → plan', () => {
  const p = parseLlmPlanMirror(
    '{"loopType":"Goal-based","steps":["搜尋 AI 剪輯工具","擷取價格","製表比較"],"definitionOfDone":"表格含 3 個工具與價格","maxIterations":3}',
  )
  assert.equal(p.loopType, 'Goal-based')
  assert.equal(p.steps.length, 3)
  assert.equal(p.maxIterations, 3)
})

await test('LLM plan: <2 steps or missing DoD → null (fallback heuristic)', () => {
  assert.equal(parseLlmPlanMirror('{"steps":["只有一步"],"definitionOfDone":"x"}'), null)
  assert.equal(parseLlmPlanMirror('{"steps":["a","b"],"definitionOfDone":""}'), null)
})

await test('LLM plan: forceLoopType wins; steps cap 7; bad loopType → Goal-based', () => {
  const steps = JSON.stringify(Array.from({ length: 10 }, (_, i) => `s${i}`))
  const p = parseLlmPlanMirror(
    `{"loopType":"Nonsense","steps":${steps},"definitionOfDone":"ok"}`,
    'Time-based',
  )
  assert.equal(p.loopType, 'Time-based')
  assert.equal(p.steps.length, 7)
  const q = parseLlmPlanMirror(`{"loopType":"Nonsense","steps":["a","b"],"definitionOfDone":"ok"}`)
  assert.equal(q.loopType, 'Goal-based')
})

// Mirror of parser.ts deriveDoD count regex (unit-suffixed only — years must not match)
const DOD_COUNT_RE = /(\d+)\s*(?:個|項|款|種|items?|tools?|options?|examples?|篇|筆)/i

await test('deriveDoD count regex: unit-suffixed hits, bare year does not', () => {
  assert.equal('找 3 個 AI 剪輯工具'.match(DOD_COUNT_RE)?.[1], '3')
  assert.equal('Find me 3 tools to compare'.match(DOD_COUNT_RE)?.[1], '3')
  assert.equal('分析 2025 年市場趨勢'.match(DOD_COUNT_RE), null)
})

await test('source contract: engine imports llmParser; parser exports buildParseResult', async () => {
  const fs = (await import('node:fs')).default
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const parser = fs.readFileSync(path.join(appRoot, 'src/agent/parser.ts'), 'utf8')
  assert.ok(engine.includes("from './llmParser'"))
  assert.ok(parser.includes('export function buildParseResult'))
  assert.ok(DOD_COUNT_RE.source === parser.match(/const DOD_COUNT_RE = \/(.+?)\/i/)?.[1]
    || parser.includes('個|項|款|種'), 'parser must use unit-suffixed count regex')
})
```

- [ ] **Step 2: 跑 smoke 確認 contract 紅**

Run: `cd app && npm run smoke`
Expected: 鏡射測試綠、`source contract: engine imports llmParser…` 紅

- [ ] **Step 3: 修補 `parser.ts`**

3a. `GOAL_KEYWORDS` 補中文（現有陣列尾端追加）：

```ts
  '找',
  '分析',
  '研究',
  '比較',
  '整理',
  '彙整',
  '產生',
  '建立',
  '報告',
  '摘要',
  '調查',
```

同時 `classifyLoopType` 的 GOAL 判斷改為同時比對原文（中文關鍵字不能 toLowerCase-only）：

```ts
  if (
    GOAL_KEYWORDS.some((k) => lower.includes(k) || input.includes(k)) ||
    input.length > 40
  )
    return 'Goal-based'
```

3b. `deriveDoD` 的數字擷取改為單位後綴限定（檔案頂部加常數，函式內改用）：

```ts
const DOD_COUNT_RE = /(\d+)\s*(?:個|項|款|種|items?|tools?|options?|examples?|篇|筆)/i
```

```ts
  const threeItems = input.match(DOD_COUNT_RE)
```

3c. 抽出共用組裝函式（`parseUserRequest` 尾段的 config+steps 組裝原樣搬入；`parseUserRequest` 改為呼叫它）：

```ts
/** Shared assembly for heuristic + LLM parsers (03 schema → ParseResult). */
export function buildParseResult(
  objective: string,
  loopType: LoopType,
  sequence: string[],
  definitionOfDone: string,
  maxIterations: number,
): ParseResult {
  const config: LoopConfiguration = {
    loopType,
    trigger:
      loopType === 'Turn-based'
        ? 'Received user input (synchronous)'
        : loopType === 'Goal-based'
          ? 'Complex objective assigned'
          : loopType === 'Time-based'
            ? 'System clock reaches predefined timestamp'
            : 'Event payload matches boolean criteria',
    executionSequence: sequence,
    definitionOfDone,
    maxIterations,
    fallbackProtocol:
      loopType === 'Goal-based'
        ? 'Halt and route to human-in-the-loop queue after max iterations'
        : 'Log error and halt',
    nextState: loopType === 'Turn-based' ? 'Await User Input' : 'Halt',
  }
  const steps: ExecutionStep[] = sequence.map((action, i) => ({
    step: i + 1,
    action: action.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_一-鿿]/g, ''),
    description: action,
    status: 'PENDING' as const,
  }))
  return { config, objective, steps }
}
```

`parseUserRequest` 尾段改為：

```ts
  return buildParseResult(
    objective,
    loopType,
    sequence,
    deriveDoD(objective, loopType, sequence.length),
    maxIterations,
  )
```

- [ ] **Step 4: 建立 `app/src/agent/llmParser.ts`**

```ts
/**
 * LLM 任務解析 — 規格 03_Agent_Prompt_Schema 的完整實作。
 * parser.ts 的啟發式版本保留為零 LLM / 解析失敗時的 fallback。
 */

import { chatCompletion } from './llm'
import { buildParseResult } from './parser'
import type { LlmSettings, LoopType, ParseResult } from './types'

const LOOP_TYPES: LoopType[] = ['Turn-based', 'Goal-based', 'Time-based', 'Proactive']

/** Pure: 驗證並轉換 LLM 計畫 JSON（null → 呼叫端 fallback 啟發式）。 */
export function parseLlmPlan(
  raw: string,
  objective: string,
  forceLoopType?: LoopType,
): ParseResult | null {
  const match = (raw || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0]) as {
      loopType?: unknown
      steps?: unknown
      definitionOfDone?: unknown
      maxIterations?: unknown
    }
    const loopType =
      forceLoopType ||
      (LOOP_TYPES.includes(obj.loopType as LoopType)
        ? (obj.loopType as LoopType)
        : 'Goal-based')
    const steps = Array.isArray(obj.steps)
      ? obj.steps
          .filter((s): s is string => typeof s === 'string' && !!s.trim())
          .slice(0, 7)
      : []
    if (steps.length < 2) return null
    const dod =
      typeof obj.definitionOfDone === 'string' && obj.definitionOfDone.trim()
        ? obj.definitionOfDone.trim().slice(0, 400)
        : ''
    if (!dod) return null
    const maxIterations =
      typeof obj.maxIterations === 'number' && obj.maxIterations >= 1
        ? Math.min(8, Math.round(obj.maxIterations))
        : loopType === 'Goal-based'
          ? 5
          : 1
    return buildParseResult(objective, loopType, steps, dod, maxIterations)
  } catch {
    return null
  }
}

export async function parseWithLlm(
  settings: LlmSettings,
  rawInput: string,
  forceLoopType?: LoopType,
): Promise<ParseResult | null> {
  const r = await chatCompletion(
    settings,
    [
      {
        role: 'system',
        content:
          '你是任務解析器（Agent Prompt Schema）。把使用者請求解析為可執行計畫。' +
          '步驟必須貼合請求內容、具體可執行（不要「Data Ingestion」這類空泛模板），2~7 步。' +
          'DoD 必須可量測。只輸出 JSON：' +
          '{"loopType":"Turn-based|Goal-based|Time-based|Proactive",' +
          '"steps":["步驟1","步驟2",...],' +
          '"definitionOfDone":"可量測驗收條件","maxIterations":1~8}',
      },
      { role: 'user', content: rawInput.slice(0, 4000) },
    ],
    { temperature: 0, maxTokens: 500 },
  )
  return parseLlmPlan(r.content, rawInput.trim(), forceLoopType)
}
```

- [ ] **Step 5: 設定欄位 `llmParseEnabled`（三處齊改，機密無關不進遮蔽清單）**

`app/src/agent/types.ts` 的 `LlmSettings` 介面加（放在 `functionCalling` 欄位旁）：

```ts
  /** LLM 解析任務計畫（規格 03）；關閉時只用啟發式 parser */
  llmParseEnabled?: boolean
```

`app/src/agent/llm.ts` 的 `DEFAULT_LLM_SETTINGS` 加：

```ts
  llmParseEnabled: true,
```

`app/src/pages/SettingsPage.tsx` 在 Function Calling 的 `SettingsRow`（`SettingsPage.tsx:1564-1573`）後加：

```tsx
              <SettingsRow
                title="LLM 任務解析"
                description="以 LLM 把請求解析為貼合目標的步驟與可量測 DoD（規格 03）；失敗自動回退啟發式模板"
                control={
                  <SettingsToggle
                    checked={settings.llmParseEnabled !== false}
                    onChange={(v) => set({ llmParseEnabled: v })}
                  />
                }
              />
```

- [ ] **Step 6: 接線 engine.ts（parse 後精煉）**

import 區加：

```ts
import { parseWithLlm } from './llmParser'
```

在 `engine.ts` `start()` 內、`this.state.steps = parsed.steps`（engine.ts:397）與 `this.state.subAgents = …` 之間插入：

```ts
      // 規格 03：LLM 解析出貼合目標的步驟與 DoD；失敗回退啟發式模板
      if (this.useLlm() && this.settings.llmParseEnabled !== false) {
        try {
          const refined = await parseWithLlm(
            withRoleModel(this.settings, 'orchestrator'),
            rawInput,
            parsed.config.loopType,
          )
          if (refined) {
            // maxIterations already resolved from settings/overrides above — keep it
            refined.config.maxIterations = parsed.config.maxIterations
            this.state.loopConfig = refined.config
            this.state.steps = refined.steps
            this.log(
              'INFO',
              `LLM 解析：${refined.steps.length} steps · DoD=${refined.config.definitionOfDone.slice(0, 80)}`,
            )
          }
        } catch (e) {
          this.log(
            'WARN',
            `LLM 解析失敗，使用啟發式計畫：${e instanceof Error ? e.message : e}`,
          )
        }
      }
```

- [ ] **Step 7: 驗證**

Run: `cd app && npm run build && npm run smoke`
Expected: build 零錯誤；smoke 全綠

- [ ] **Step 8: Commit**

```bash
git add app/src/agent/llmParser.ts app/src/agent/parser.ts app/src/agent/engine.ts \
  app/src/agent/types.ts app/src/agent/llm.ts app/src/pages/SettingsPage.tsx \
  app/scripts/smoke-caps.mjs
git commit -m "feat(parser): LLM-driven request parsing per spec 03 with heuristic fallback"
```

---

### Task 3: 迭代回饋（DoD 缺口 → 下一輪修正）

依賴 Task 1 的 `missing`。

**Files:**
- Modify: `app/src/agent/engine.ts:1308-1311`（runGoalBased 迭代重置段）
- Test: `app/scripts/smoke-caps.mjs`（source contract）

- [ ] **Step 1: smoke source contract（先寫，紅）**

```js
await test('source contract: Goal-based re-arms ALL steps when DoD unmet after allDone', async () => {
  const fs = (await import('node:fs')).default
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.ok(src.includes('上一輪 DoD 缺口'), 'missing-criteria feedback must be pushed to stepOutputs')
  assert.ok(src.includes('allDone && !dodMet'), 'all-done-but-unmet must reset all steps (no empty spin)')
})
```

Run: `cd app && npm run smoke` → Expected: 紅

- [ ] **Step 2: 改 engine.ts 迭代重置段**

把現行（engine.ts:1308-1311）：

```ts
      this.state.steps = this.state.steps.map((s) =>
        s.status === 'COMPLETED' ? s : { ...s, status: 'PENDING' as const },
      )
      this.emit()
```

改為：

```ts
      if (allDone && !dodMet) {
        // 步驟全完成但 DoD 未達：全部重跑並附缺口回饋，否則下一輪 0 步驟空轉到 max
        if (missing.length) {
          this.stepOutputs.push(
            `### 上一輪 DoD 缺口（本輪必須補齊）\n${missing.map((m) => `- ${m}`).join('\n')}`,
          )
          this.log('PROCESS', `迭代回饋：${missing.length} 項缺口已注入下一輪上下文`)
        }
        this.state.steps = this.state.steps.map((s) => ({
          ...s,
          status: 'PENDING' as const,
        }))
      } else {
        this.state.steps = this.state.steps.map((s) =>
          s.status === 'COMPLETED' ? s : { ...s, status: 'PENDING' as const },
        )
      }
      this.emit()
```

（`stepOutputs` 會經 `compressStepOutputs` 進入下一輪 FC context —— engine.ts:666 已有此管線，缺口回饋自然被模型看到。）

- [ ] **Step 3: 驗證 + Commit**

Run: `cd app && npm run build && npm run smoke` → Expected: 全綠

```bash
git add app/src/agent/engine.ts app/scripts/smoke-caps.mjs
git commit -m "feat(engine): feed DoD gaps into next iteration; re-arm steps to avoid empty spin"
```

---

### Task 4: 記憶相關性召回（objective-matched recall）

**Files:**
- Modify: `app/src/agent/hermes/memory.ts:91-113`（`buildPromptBlock` 增加 objective 參數）
- Modify: `app/src/agent/hermes/promptBuilder.ts:162`（傳入 objective）
- Test: `app/scripts/smoke-caps.mjs`

- [ ] **Step 1: smoke 鏡射測試（先寫）**

```js
// ── Memory relevance recall (Task 4) — mirror of MemoryStore.search scoring
function memorySearchMirror(entries, query, limit = 8) {
  const q = query.toLowerCase().trim()
  if (!q) return entries.slice(0, limit)
  return entries
    .map((e) => {
      const hay = e.text.toLowerCase()
      let score = 0
      for (const w of q.split(/\s+/)) {
        if (w.length > 1 && hay.includes(w)) score += 1
      }
      return { e, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e)
}

await test('memory recall: objective-matched entries rank before unrelated', () => {
  const entries = [
    { text: '無關：昨天午餐吃了拉麵' },
    { text: '教訓：抓取 GitHub API 要帶 token 否則 rate limit' },
  ]
  const hits = memorySearchMirror(entries, 'github api 抓取 issues')
  assert.equal(hits.length, 1)
  assert.ok(hits[0].text.includes('GitHub'))
})

await test('source contract: buildPromptBlock accepts objective; promptBuilder passes it', async () => {
  const fs = (await import('node:fs')).default
  const mem = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/memory.ts'), 'utf8')
  const pb = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/promptBuilder.ts'), 'utf8')
  assert.ok(/buildPromptBlock\(enabled = true, objective\?: string\)/.test(mem))
  assert.ok(pb.includes('buildPromptBlock(memoryOn, opts?.objective)'))
})
```

Run: `cd app && npm run smoke` → Expected: contract 紅

- [ ] **Step 2: 改 `memory.ts` `buildPromptBlock`**

簽名與內容改為：

```ts
  /** Volatile prompt block；objective 提供時附「與目標相關記憶」top-3 */
  buildPromptBlock(enabled = true, objective?: string): string {
    if (!enabled) {
      return '## 持久記憶（Memory）\n（記憶已關閉，不帶入跨對話上下文。）'
    }
    const parts: string[] = ['## 持久記憶（Memory）']
    if (this.userProfile.trim()) {
      parts.push('### 使用者檔案 (USER)', this.userProfile.trim().slice(0, 1500))
    }
    if (this.memory.trim()) {
      parts.push('### 長期記憶 (MEMORY)', this.memory.trim().slice(0, 3000))
    }
    const recent = this.entries.slice(0, 5)
    if (recent.length) {
      parts.push(
        '### 近期條目',
        ...recent.map((e) => `- ${e.text.slice(0, 200)}`),
      )
    }
    if (objective?.trim()) {
      const recentIds = new Set(recent.map((e) => e.id))
      const related = this.search(objective, 3).filter((e) => !recentIds.has(e.id))
      if (related.length) {
        parts.push(
          '### 與本目標相關記憶',
          ...related.map((e) => `- ${e.text.slice(0, 200)}`),
        )
      }
    }
    if (parts.length === 1) {
      parts.push('（尚無記憶。重要偏好請用 memory_append 寫入。）')
    }
    return parts.join('\n')
  }
```

- [ ] **Step 3: 改 `promptBuilder.ts:162`**

```ts
    memoryStore.buildPromptBlock(memoryOn, opts?.objective),
```

- [ ] **Step 4: 驗證 + Commit**

Run: `cd app && npm run build && npm run smoke` → Expected: 全綠

```bash
git add app/src/agent/hermes/memory.ts app/src/agent/hermes/promptBuilder.ts app/scripts/smoke-caps.mjs
git commit -m "feat(hermes): objective-matched memory recall in volatile prompt layer"
```

---

### Task 5: 失敗學習（onGoalFailure）

**Files:**
- Modify: `app/src/agent/hermes/learning.ts`（新增 `onGoalFailure`）
- Modify: `app/src/agent/engine.ts`（`noteLearningFailure` helper + 兩個失敗點呼叫）
- Test: `app/scripts/smoke-caps.mjs`（source contract）

- [ ] **Step 1: smoke source contract（先寫，紅）**

```js
await test('source contract: failure learning wired (learning + engine both sides)', async () => {
  const fs = (await import('node:fs')).default
  const learning = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/learning.ts'), 'utf8')
  const engine = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  assert.ok(learning.includes('onGoalFailure'), 'learningLoop.onGoalFailure must exist')
  assert.ok(engine.includes('noteLearningFailure'), 'engine failure paths must note lessons')
  // Both failure sites: Goal-based max-iterations + Time/Proactive all-tools-failed
  assert.ok(engine.match(/noteLearningFailure\(/g).length >= 3, 'helper + ≥2 call sites')
})
```

Run: `cd app && npm run smoke` → Expected: 紅

- [ ] **Step 2: `learning.ts` 加 `onGoalFailure`（放在 `onGoalSuccess` 後）**

```ts
  /** 失敗後記錄教訓（Hermes 閉環：避免重複犯錯）。事件沿用 memory_saved 型別。 */
  onGoalFailure(input: {
    objective: string
    haltReason: string
    loopType: string
    failedTools?: string[]
    memoryEnabled?: boolean
    memoryWriteEnabled?: boolean
  }) {
    const canWrite =
      input.memoryEnabled !== false && input.memoryWriteEnabled !== false
    if (!canWrite) return
    const toolNote = input.failedTools?.length
      ? `；失敗工具：${input.failedTools.slice(0, 5).join(', ')}`
      : ''
    memoryStore.appendMemory(
      `目標失敗：${input.objective.slice(0, 100)}（${input.loopType}）原因：${input.haltReason.slice(0, 120)}${toolNote}`,
      ['failure', 'auto'],
    )
    this.emit({
      id: uuid(),
      type: 'memory_saved',
      message: '已將失敗教訓寫入記憶（同類目標下次會帶入相關記憶）。',
      at: new Date().toISOString(),
    })
  }
```

- [ ] **Step 3: engine.ts 加 helper（放在 `noteLearningSuccess` 後）**

```ts
  /** Shared failure-lesson hook（max iterations / all tools failed） */
  private noteLearningFailure(loopType: string, haltReason: string) {
    try {
      learningLoop.onGoalFailure({
        objective: this.state.objective,
        haltReason,
        loopType,
        failedTools: [
          ...new Set(
            (this.state.toolCalls || []).filter((t) => !t.ok).map((t) => t.tool),
          ),
        ],
        memoryEnabled: this.settings.memoryEnabled,
        memoryWriteEnabled:
          this.settings.memoryWriteEnabled !== false &&
          this.overrides.temporary !== true &&
          this.settings.temporaryChatDefault !== true,
      })
      this.log('INFO', '學習迴圈：已記錄失敗教訓（見學習中心／記憶）')
    } catch {
      /* non-fatal */
    }
  }
```

呼叫點 1 — `runGoalBased` max-iterations 分支（engine.ts:1298-1306），在 `this.emit()` 前加：

```ts
        this.noteLearningFailure(this.state.loopConfig.loopType, this.state.haltReason)
```

呼叫點 2 — `finalizePatternRun` 全工具失敗分支（engine.ts:1405-1416），在 `this.emit()` 前加：

```ts
      this.noteLearningFailure(opts.loopType, this.state.haltReason)
```

- [ ] **Step 4: 驗證 + Commit**

Run: `cd app && npm run build && npm run smoke` → Expected: 全綠

```bash
git add app/src/agent/hermes/learning.ts app/src/agent/engine.ts app/scripts/smoke-caps.mjs
git commit -m "feat(hermes): record failure lessons to memory (closed learning loop)"
```

---

### Task 6: Turn-based 無人值守自動 ACK（防禦性）

**Files:**
- Modify: `app/src/agent/engine.ts:1225-1229`（runTurnBased）
- Test: `app/scripts/smoke-caps.mjs`（source contract）

- [ ] **Step 1: smoke source contract（先寫，紅）**

```js
await test('source contract: Turn-based skips waitForUser when unattended', async () => {
  const fs = (await import('node:fs')).default
  const src = fs.readFileSync(path.join(appRoot, 'src/agent/engine.ts'), 'utf8')
  const turnSection = src.slice(src.indexOf('runTurnBased'), src.indexOf('runGoalBased'))
  assert.ok(
    turnSection.includes('unattended') && turnSection.includes('waitForUser'),
    'runTurnBased must gate waitForUser on overrides.unattended',
  )
})
```

Run: `cd app && npm run smoke` → Expected: 紅

- [ ] **Step 2: 改 `runTurnBased`**

把（engine.ts:1225-1229）：

```ts
    this.log('SUCCESS', 'Action completed. Awaiting user validation (ACK).')

    await this.waitForUser()
    if (this.aborted) return
```

改為：

```ts
    if (this.overrides.unattended === true) {
      // 排程/webhook/事件源無使用者可 ACK — 自動確認，避免全域鎖永久掛起
      this.log('WARN', '無人值守 Turn-based：跳過人工 ACK，自動確認')
    } else {
      this.log('SUCCESS', 'Action completed. Awaiting user validation (ACK).')
      await this.waitForUser()
      if (this.aborted) return
    }
```

- [ ] **Step 3: 驗證 + Commit**

Run: `cd app && npm run build && npm run smoke` → Expected: 全綠

```bash
git add app/src/agent/engine.ts app/scripts/smoke-caps.mjs
git commit -m "fix(engine): auto-ACK Turn-based runs when unattended (global lock cannot hang)"
```

---

### Task 7: CJK 感知匹配（技能索引 + 意圖 preload）

**Files:**
- Modify: `app/src/agent/hermes/skills.ts:193-199`（`matchForObjective` + 新 helper）
- Modify: `app/src/agent/intentPreload.ts:15-23`（`scoreHay` CJK bigram）
- Test: `app/scripts/smoke-caps.mjs`

- [ ] **Step 1: smoke 鏡射測試（先寫）**

```js
// ── CJK-aware matching (Task 7) — mirror of skills.ts cjkAwareHit
function cjkAwareHit(hay, objective) {
  const lower = objective.toLowerCase()
  const h = hay.toLowerCase()
  if (h.split(/\s+/).some((w) => w.length > 3 && lower.includes(w))) return true
  const cjk = h.match(/[一-鿿]{2,}/g) || []
  for (const seq of cjk) {
    for (let i = 0; i + 2 <= seq.length; i++) {
      if (objective.includes(seq.slice(i, i + 2))) return true
    }
  }
  return false
}

await test('CJK match: Chinese skill hits Chinese objective (bigram)', () => {
  assert.equal(cjkAwareHit('銷售報表 產生每週銷售摘要', '幫我整理本週銷售資料'), true)
})

await test('CJK match: ASCII words still need >3 chars; unrelated CJK misses', () => {
  assert.equal(cjkAwareHit('github issue triage', '請 triage 這批 github issues'), true)
  assert.equal(cjkAwareHit('天氣預報技能', '幫我整理銷售資料'), false)
})

await test('source contract: skills + intentPreload use CJK-aware matching', async () => {
  const fs = (await import('node:fs')).default
  const skills = fs.readFileSync(path.join(appRoot, 'src/agent/hermes/skills.ts'), 'utf8')
  const intent = fs.readFileSync(path.join(appRoot, 'src/agent/intentPreload.ts'), 'utf8')
  assert.ok(skills.includes('export function cjkAwareHit'))
  assert.ok(intent.includes('[\\u4e00-\\u9fff]{2,}') || intent.includes('cjkAwareHit'))
})
```

Run: `cd app && npm run smoke` → Expected: contract 紅

- [ ] **Step 2: `skills.ts` 加 helper 並改 `matchForObjective`**

在 `SkillsStore` class 之前加：

```ts
/**
 * CJK 感知匹配：ASCII 詞 >3 字元包含比對；中文（無空白分詞）改用 bigram。
 * 供 skills 索引與 intent preload 共用。
 */
export function cjkAwareHit(hay: string, objective: string): boolean {
  const lower = objective.toLowerCase()
  const h = hay.toLowerCase()
  if (h.split(/\s+/).some((w) => w.length > 3 && lower.includes(w))) return true
  const cjk = h.match(/[一-鿿]{2,}/g) || []
  for (const seq of cjk) {
    for (let i = 0; i + 2 <= seq.length; i++) {
      if (objective.includes(seq.slice(i, i + 2))) return true
    }
  }
  return false
}
```

`matchForObjective` 改為：

```ts
  matchForObjective(objective: string): Skill[] {
    return this.list().filter((s) =>
      cjkAwareHit(
        `${s.meta.name} ${s.meta.description} ${(s.meta.tags || []).join(' ')}`,
        objective,
      ),
    )
  }
```

- [ ] **Step 3: `intentPreload.ts` `scoreHay` 加 CJK bigram 計分**

```ts
function scoreHay(hay: string, objective: string): number {
  const lower = objective.toLowerCase()
  let score = 0
  for (const w of hay.toLowerCase().split(/[\s,|/]+/)) {
    if (w.length < 3) continue
    if (lower.includes(w)) score += w.length > 5 ? 2 : 1
  }
  // 中文：hay 的連續 CJK 片段以 bigram 對 objective 比對（每片段最多 +2）
  const cjkSeqs = hay.match(/[一-鿿]{2,}/g) || []
  for (const seq of cjkSeqs) {
    for (let i = 0; i + 2 <= seq.length; i++) {
      if (objective.includes(seq.slice(i, i + 2))) {
        score += 2
        break
      }
    }
  }
  return score
}
```

- [ ] **Step 4: 驗證 + Commit**

Run: `cd app && npm run build && npm run smoke` → Expected: 全綠

```bash
git add app/src/agent/hermes/skills.ts app/src/agent/intentPreload.ts app/scripts/smoke-caps.mjs
git commit -m "feat(hermes): CJK-aware skill/intent matching (bigram for Chinese objectives)"
```

---

### Task 8: 文件同步 + 稽核記錄

**Files:**
- Modify: `CLAUDE.md`（repository layout 段）
- Modify: `docs/WORKFLOW_AUDIT.md`（追加第七輪）
- Commit: 根目錄規格檔刪除 + `docs/` 新增（git status 既有的 pending 搬移）

- [ ] **Step 1: 更新 `CLAUDE.md` layout 段**

把：

```markdown
- `01_…` / `02_…` / `03_…` `.md` — the loop spec (system definition, four loop patterns, request-parsing schema) the engine implements
- `ai_agent_loop_*/code.html`, `synthetic_intelligence_interface/DESIGN.md` — Stitch UI mocks / design tokens
- `docs/` — integration plans; `docs/PYDANTIC_AI_V2_CAPABILITIES.md` maps the capability system concepts to files
```

改為：

```markdown
- `docs/01_…` / `02_…` / `03_…` `.md` — the loop spec (system definition, four loop patterns, request-parsing schema) the engine implements
- `docs/` — integration plans and audits; `docs/PYDANTIC_AI_V2_CAPABILITIES.md` maps the capability system concepts to files; `docs/WORKFLOW_AUDIT.md` is the living audit ledger
```

（`ai_agent_loop_*` mock 已自 repo 移除，該行刪除。）

- [ ] **Step 2: `docs/WORKFLOW_AUDIT.md` 追加第七輪段**

在檔尾 `*稽核方式…*` 前插入：

```markdown
---

## 10. 第七輪稽核（2026-07-11）— Loop Engine × Hermes 核心

聚焦「兩類核心是否完整且真正用於任務執行」。呼應關係驗證通過（四模式統一管線、
Hermes 三路徑注入、學習迴圈含 CLI、委派隔離、意圖 preload）；發現的缺口與修補計畫見
`docs/LOOP_HERMES_GAP_PLAN.md`（G-A 語意 DoD、G-B LLM 解析、G-C 迭代回饋、
G-D 記憶相關性召回、G-E 失敗學習、G-F Turn-based unattended、G-G CJK 匹配、G-H 文件漂移）。
```

- [ ] **Step 3: 提交文件搬移 + 更新**

```bash
git add CLAUDE.md docs/ \
  "01_System_Definition (系統定義).md" "02_Execution_Rules (執行規則).md" \
  "03_Agent_Prompt_Schema (解析模板).md" ai_agent_loop_1 ai_agent_loop_2 ai_agent_loop_3 \
  ai_agent_loop_4 ai_agent_loop_5 ai_agent_loop_6 ai_agent_loop_7 ai_agent_loop_8 \
  ai_agent_loop_9 ai_agent_loop_10 ai_agent_loop_goal_based
git commit -m "docs: move loop spec into docs/, sync CLAUDE.md layout, add round-7 audit entry"
```

（`git add` 已刪除路徑 = 記錄刪除；若這些刪除是誤刪需還原，先與使用者確認再執行本步。）

---

## Self-Review 核對

- 規格覆蓋：01（Validate/Iterate 元件）→ Task 1/3；02 Pattern 2（DoD 自評、不可 partial-met 終止）→ Task 1；02 Pattern 1（await user validation）在 unattended 情境的安全化 → Task 6；03（MUST parse schema）→ Task 2；Hermes 閉環（記憶召回/避免重複犯錯）→ Task 4/5/7。
- 型別一致：`DodVerdict`/`parseDodVerdict`（Task 1）與 engine 使用一致；`buildParseResult`（Task 2 Step 3c）先於 `llmParser.ts`（Step 4）引用；`cjkAwareHit` 名稱在 Task 7 兩檔一致。
- 無 placeholder：每個程式步驟皆含完整程式碼與確切檔案/行號錨點；行號以 2026-07-11 工作樹為準，若已漂移以引用的原始碼片段為錨。
- 驗證一律 `npm run build` + `npm run smoke`；本 repo 無單元測試框架，新測試全部進 `smoke-caps.mjs`（鏡射 + source contract，沿用既有 side-effect drift guard 模式）。
