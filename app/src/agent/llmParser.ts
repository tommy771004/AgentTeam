/**
 * LLM 任務解析 — 規格 03 Agent Prompt Schema。
 * parser.ts 的啟發式版本保留為零 LLM 或解析失敗時的 fallback。
 */

import { chatCompletion } from './llm'
import { buildParseResult } from './parser'
import type { LlmSettings, LoopType, NextState, ParseResult } from './types'

const LOOP_TYPES: LoopType[] = ['Turn-based', 'Goal-based', 'Time-based', 'Proactive']
const AUTO_LOOP_TYPES: LoopType[] = ['Turn-based', 'Goal-based']

/** Pure: validate a model-produced plan; invalid output returns null. */
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
      nextState?: unknown
    }
    const allowedLoopTypes = forceLoopType ? LOOP_TYPES : AUTO_LOOP_TYPES
    const loopType =
      forceLoopType ||
      (allowedLoopTypes.includes(obj.loopType as LoopType)
        ? (obj.loopType as LoopType)
        : 'Goal-based')
    const steps = Array.isArray(obj.steps)
      ? obj.steps
          .filter((step): step is string => typeof step === 'string' && !!step.trim())
          .map((step) => step.trim().slice(0, 240))
          .slice(0, 7)
      : []
    const definitionOfDone =
      typeof obj.definitionOfDone === 'string'
        ? obj.definitionOfDone.trim().slice(0, 400)
        : ''
    // Turn-based / Chat-lite may be a single step; Goal needs ≥2.
    const minSteps = loopType === 'Turn-based' ? 1 : 2
    if (steps.length < minSteps || !definitionOfDone) return null
    const maxIterations =
      typeof obj.maxIterations === 'number' && obj.maxIterations >= 1
        ? Math.min(8, Math.round(obj.maxIterations))
        : loopType === 'Goal-based'
          ? 5
          : 1
    const nextState: NextState =
      obj.nextState === 'Await User Input'
        ? 'Await User Input'
        : obj.nextState === 'Dispatch Webhook'
          ? 'Dispatch Webhook'
          : loopType === 'Turn-based'
            ? 'Await User Input'
            : 'Halt'
    return buildParseResult(objective, loopType, steps, definitionOfDone, maxIterations, nextState)
  } catch {
    return null
  }
}

export async function parseWithLlm(
  settings: LlmSettings,
  rawInput: string,
  forceLoopType?: LoopType,
): Promise<ParseResult | null> {
  const loopTypeSchema = forceLoopType || 'Turn-based|Goal-based'
  const result = await chatCompletion(
    settings,
    [
      {
        role: 'system',
        content:
          '你是任務解析器（Agent Prompt Schema）。把使用者請求解析為具體可執行的 2~7 步計畫，' +
          '不要使用空泛模板。DoD 必須可量測。只輸出 JSON：' +
          (forceLoopType
            ? `Loop type 已由有效 trigger 明確指定為 ${forceLoopType}。`
            : '對話自動分類只允許 Turn-based 或 Goal-based；若文字含 cron/event 語意，請保留為 Goal-based 建議，不得輸出 Time-based 或 Proactive。') +
          `{"loopType":"${loopTypeSchema}",` +
          '"steps":["步驟1"],"definitionOfDone":"可量測驗收條件","maxIterations":1~8,"nextState":"Halt|Await User Input|Dispatch Webhook"}',
      },
      { role: 'user', content: rawInput.slice(0, 4_000) },
    ],
    { temperature: 0, maxTokens: 500 },
  )
  return parseLlmPlan(result.content, rawInput.trim(), forceLoopType)
}
