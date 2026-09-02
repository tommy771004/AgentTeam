/**
 * ModelProfile: per-model capability facts with provenance.
 *
 * Principles:
 * - Never auto-probe (probes cost tokens): 'verified' only via the explicit
 *   Settings「驗證模型能力」action.
 * - Heuristics from the model id are stored as 'assumed', shown as 推測.
 * - Unknown stays undefined → runtime picks the conservative path and logs
 *   the degrade BEFORE the task fails mid-run.
 */

import type { LlmSettings, ModelProfile } from './types.ts'
import { chatCompletionWithTools } from './llm.ts'

/** 1×1 transparent PNG — cheapest possible vision probe payload. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export function getModelProfile(
  settings: Pick<LlmSettings, 'modelProfiles'>,
  modelId: string | undefined,
): ModelProfile | null {
  const id = (modelId || '').trim()
  if (!id) return null
  return settings.modelProfiles?.[id] || null
}

/**
 * Runtime capability check. Returns:
 *  true/false — profile says so (verified or assumed)
 *  undefined  — unknown → caller decides the conservative default
 */
export function modelSupports(
  settings: Pick<LlmSettings, 'modelProfiles'>,
  modelId: string | undefined,
  cap: 'tools' | 'vision' | 'structuredOutput',
): boolean | undefined {
  const p = getModelProfile(settings, modelId)
  if (!p) return undefined
  return p[cap]
}

/** Heuristic (assumed) profile from the model id — no network cost. */
export function assumeProfile(modelId: string): ModelProfile {
  const id = modelId.toLowerCase()
  const contextWindow = id.includes('128k')
    ? 128_000
    : id.includes('32k')
      ? 32_000
      : id.includes('16k')
        ? 16_000
        : undefined
  // Well-known families that support tools + vision
  const modern =
    /gpt-4|gpt-5|o[1-9]|claude|gemini|qwen|glm|deepseek|mistral-large|grok/.test(id)
  return {
    modelId,
    tools: modern ? true : undefined,
    vision:
      /vision|4o|o[1-9]|claude-3|claude-[4-9]|gemini|gpt-5|qwen.*vl/.test(id)
        ? true
        : undefined,
    structuredOutput: modern ? true : undefined,
    contextWindow,
    source: 'assumed',
  }
}

export type VerifyResult = {
  profile: ModelProfile
  logs: string[]
}

/**
 * Explicit capability probe (user-triggered). Three minimal calls:
 * tools (forced echo tool) / structured output (strict JSON) / vision (1px PNG).
 */
export async function verifyModelCapabilities(
  settings: LlmSettings,
  modelId: string,
): Promise<VerifyResult> {
  const logs: string[] = []
  const s: LlmSettings = { ...settings, model: modelId }
  // Rates the user typed are not a capability and no probe can re-derive them,
  // so they are carried across the re-derivation rather than silently erased.
  const existingPricing = settings.modelProfiles?.[modelId]?.pricing
  const profile: ModelProfile = {
    ...assumeProfile(modelId),
    modelId,
    ...(existingPricing ? { pricing: existingPricing } : {}),
    source: 'verified',
    lastVerifiedAt: new Date().toISOString(),
  }

  // 1) tools
  try {
    const r = await chatCompletionWithTools(
      s,
      [{ role: 'user', content: 'Call the echo tool with text="ok".' }],
      [
        {
          type: 'function',
          function: {
            name: 'echo',
            description: 'Echo text back',
            parameters: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        },
      ],
      { temperature: 0, maxTokens: 60, toolChoice: 'required' },
    )
    profile.tools = r.toolCalls.length > 0
    logs.push(`tools: ${profile.tools ? '✓ 支援' : '✗ 未回傳 tool_calls'}`)
  } catch (e) {
    profile.tools = false
    profile.note = e instanceof Error ? e.message.slice(0, 160) : String(e)
    logs.push(`tools: ✗（${profile.note}）`)
  }

  // 2) structured output
  try {
    const r = await chatCompletionWithTools(
      s,
      [
        {
          role: 'user',
          content: 'Reply with ONLY this exact JSON, no prose: {"ok":true,"n":1}',
        },
      ],
      [],
      { temperature: 0, maxTokens: 40, toolChoice: 'none' },
    )
    const text = r.content.trim().replace(/^```(?:json)?|```$/g, '').trim()
    const parsed = JSON.parse(text) as { ok?: boolean }
    profile.structuredOutput = parsed?.ok === true
    logs.push(`structured output: ${profile.structuredOutput ? '✓' : '✗ JSON 不精確'}`)
  } catch {
    profile.structuredOutput = false
    logs.push('structured output: ✗（無法解析 JSON）')
  }

  // 3) vision (1px image)
  try {
    const r = await chatCompletionWithTools(
      s,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Reply with the single word: ok' },
            { type: 'image_url', image_url: { url: TINY_PNG, detail: 'low' } },
          ],
        },
      ],
      [],
      { temperature: 0, maxTokens: 12, toolChoice: 'none' },
    )
    profile.vision = /ok/i.test(r.content)
    logs.push(`vision: ${profile.vision ? '✓ 支援' : '✗ 回覆異常'}`)
  } catch (e) {
    profile.vision = false
    logs.push(
      `vision: ✗（${e instanceof Error ? e.message.slice(0, 120) : String(e)}）`,
    )
  }

  return { profile, logs }
}
