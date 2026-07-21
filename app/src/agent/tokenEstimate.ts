/**
 * Token 估算單一來源 — bytes/4 啟發式(Grok Build `xai-token-estimation` 風格)。
 *
 * auto-compact gate、呼叫前 preflight overflow check、UI context meter
 * 一律使用這裡的算式,不得另立度量(supervisor 的 payload byte 限制
 * 是工具輸出防線,與 context 用量是兩件事)。
 */

import type { LlmSettings } from './types'

/** Leaf lookup — avoids importing modelProfile (which pulls llm). */
function profileContextWindow(
  settings: Pick<LlmSettings, 'modelProfiles'>,
  modelId: string | undefined,
): number | undefined {
  const id = (modelId || '').trim()
  if (!id) return undefined
  const cw = settings.modelProfiles?.[id]?.contextWindow
  return cw && cw > 0 ? cw : undefined
}

/** modelProfiles 無 contextWindow 且 settings 未覆寫時的保守預設。 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 64_000

/** 每則訊息的固定結構開銷(role/分隔 token)。 */
const MESSAGE_OVERHEAD_TOKENS = 4

/** image_url part 的固定估算(data URL bytes 與實際 vision token 無關)。 */
const IMAGE_PART_TOKENS = 1_000

export function estimateTokensFromText(text: string | null | undefined): number {
  if (!text) return 0
  return Math.ceil(new TextEncoder().encode(text).length / 4)
}

/** 與 llm.ts ChatMessageExt / compaction CompactableMessage 皆相容的最小形狀。 */
export interface EstimatableMessage {
  content?: unknown
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
}

export function estimateMessageTokens(m: EstimatableMessage): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS
  const c = m.content
  if (typeof c === 'string') {
    tokens += estimateTokensFromText(c)
  } else if (Array.isArray(c)) {
    for (const part of c as Array<{ type?: string; text?: string }>) {
      if (part?.type === 'image_url') tokens += IMAGE_PART_TOKENS
      else if (typeof part?.text === 'string') tokens += estimateTokensFromText(part.text)
    }
  }
  for (const tc of m.tool_calls || []) {
    tokens += estimateTokensFromText(tc.function?.name)
    tokens += estimateTokensFromText(tc.function?.arguments)
  }
  return tokens
}

export function estimateTranscriptTokens(messages: EstimatableMessage[]): number {
  let total = 0
  for (const m of messages) total += estimateMessageTokens(m)
  return total
}

/** Model profile → settings 覆寫 → 保守預設。 */
export function resolveContextWindow(
  settings: Pick<LlmSettings, 'modelProfiles' | 'defaultContextWindowTokens'>,
  modelId?: string,
): number {
  const fromProfile = profileContextWindow(settings, modelId)
  if (fromProfile) return fromProfile
  const fallback = settings.defaultContextWindowTokens
  if (typeof fallback === 'number' && fallback >= 1000) return fallback
  return DEFAULT_CONTEXT_WINDOW_TOKENS
}

export interface ContextUsage {
  tokens: number
  contextWindow: number
  /** 0–1(可 >1 表示已溢位) */
  ratio: number
}

export function contextUsage(tokens: number, contextWindow: number): ContextUsage {
  const cw = Math.max(1, contextWindow)
  return { tokens, contextWindow: cw, ratio: tokens / cw }
}

/**
 * 呼叫前 preflight:估算已超過 contextWindow − reserve 就先壓縮再送,
 * 避免 API 直接 400(reserve = 回覆 maxTokens + 安全邊際)。
 */
export function shouldPreflightCompact(
  estimatedTokens: number,
  contextWindow: number,
  reserveTokens = 2_500,
): boolean {
  return estimatedTokens > Math.max(1_024, contextWindow - reserveTokens)
}
