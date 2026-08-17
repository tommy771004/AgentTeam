/**
 * DoD 語意驗收 — 規格 02 Pattern 2：Agent 必須依定義完成條件自評。
 * 無法取得或解析 LLM 判定時拋出，讓 engine 安全回退既有啟發式。
 */

import { chatCompletion } from './llm.ts'
import type { LlmSettings } from './types.ts'

export interface DodVerdict {
  met: boolean
  confidence: number
  missing: string[]
  tokensUsed: number
}

/** Pure: tolerant JSON parser for a validator response. */
export function parseDodVerdict(
  raw: string,
): Omit<DodVerdict, 'tokensUsed'> | null {
  const match = (raw || '').trim().match(/\{[\s\S]*\}/)
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
          .filter((item): item is string => typeof item === 'string' && !!item.trim())
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
  const evidence = stepOutputs.slice(-6).join('\n---\n').slice(0, 9_000)
  const result = await chatCompletion(
    settings,
    [
      {
        role: 'system',
        content:
          '你是驗收代理（Validator）。根據 Definition of Done 逐項檢查執行輸出是否達標。' +
          '證據不足或只部分達成時，met 必須為 false。' +
          '只輸出 JSON：{"met":true|false,"confidence":0~1,"missing":["具體缺口",...]}',
      },
      {
        role: 'user',
        content: `目標：${objective}\n\nDefinition of Done：${definitionOfDone}\n\n執行輸出（近 6 步）：\n${evidence || '（無輸出）'}`,
      },
    ],
    { temperature: 0, maxTokens: 400 },
  )
  const verdict = parseDodVerdict(result.content)
  if (!verdict) {
    throw new Error(`DoD verdict unparsable: ${result.content.slice(0, 120)}`)
  }
  return { ...verdict, tokensUsed: result.tokensUsed }
}
