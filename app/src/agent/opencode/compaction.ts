/**
 * Session context compaction — OpenCode-inspired
 * When transcript grows large, summarize older turns for continued work.
 *
 * CRITICAL: preserve OpenAI tool-call chains:
 *   assistant { tool_calls: [...] } → tool { tool_call_id } messages
 * Flattening to {role, content} only breaks subsequent FC rounds (API 400).
 */

import type { LlmSettings } from '../types'
import { chatCompletion } from '../llm'
import { getCompactionConfig, getSmallModel } from './agentRegistry'

export type CompactableMessage = {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

function messageWeight(m: CompactableMessage): number {
  let n = (m.content || '').length
  if (m.tool_calls?.length) {
    for (const tc of m.tool_calls) {
      n += (tc.function?.name || '').length + (tc.function?.arguments || '').length
    }
  }
  return n
}

/**
 * Align index so we never start "recent" mid tool-call chain
 * (orphaned tool messages without their assistant.tool_calls parent).
 */
function alignKeepStart(body: CompactableMessage[], keepRecent: number): number {
  let start = Math.max(0, body.length - keepRecent)
  // Walk back while current message is a tool result
  while (start > 0 && body[start]?.role === 'tool') {
    start -= 1
  }
  // If we land on assistant with tool_calls, include it (already start)
  // If previous is assistant with tool_calls and we're on first tool, include assistant
  if (start > 0 && body[start]?.role === 'tool') {
    // find assistant
    let i = start
    while (i > 0 && body[i]?.role === 'tool') i -= 1
    if (body[i]?.role === 'assistant' && body[i]?.tool_calls?.length) start = i
  }
  return start
}

/**
 * If total chars exceed budget, keep last `keepRecent` messages and
 * replace the rest with a single summary message.
 * Tool-call structure on retained messages is preserved verbatim.
 */
export async function maybeCompactMessages(
  settings: LlmSettings,
  messages: CompactableMessage[],
  opts?: { maxChars?: number; keepRecent?: number; force?: boolean },
): Promise<{ messages: CompactableMessage[]; compacted: boolean; summary?: string }> {
  const cfg = getCompactionConfig()
  if (cfg.auto === false && !opts?.force) {
    return { messages, compacted: false }
  }

  const maxChars = opts?.maxChars ?? Math.max(12_000, 80_000 - (cfg.reserved || 8000))
  const keepRecent = opts?.keepRecent ?? 6
  const total = messages.reduce((n, m) => n + messageWeight(m), 0)
  if (total <= maxChars || messages.length <= keepRecent + 2) {
    return { messages, compacted: false }
  }

  const head = messages[0]?.role === 'system' ? [messages[0]] : []
  const startIdx = head.length
  const body = messages.slice(startIdx)
  if (body.length <= keepRecent) return { messages, compacted: false }

  const keepStart = alignKeepStart(body, keepRecent)
  if (keepStart <= 0) return { messages, compacted: false }

  const old = body.slice(0, keepStart)
  const recent = body.slice(keepStart)

  // Build extractive summary without needing tool_calls structure
  const blob = old
    .map((m) => {
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const names = m.tool_calls.map((t) => t.function.name).join(', ')
        return `assistant: (tool_calls: ${names}) ${(m.content || '').slice(0, 400)}`
      }
      if (m.role === 'tool') {
        return `tool${m.tool_call_id ? `(${m.tool_call_id.slice(0, 8)})` : ''}: ${(m.content || '').slice(0, 800)}`
      }
      return `${m.role}: ${(m.content || '').slice(0, 1500)}`
    })
    .join('\n\n')
    .slice(0, 24_000)

  let summary = `[Compacted ${old.length} earlier messages]\n` + blob.slice(0, 2000)

  const small = getSmallModel()
  if (settings.enabled && settings.apiKey) {
    try {
      const s: LlmSettings = {
        ...settings,
        model: small || settings.model,
      }
      const r = await chatCompletion(
        s,
        [
          {
            role: 'system',
            content:
              'You compress agent transcripts. Output a concise Markdown summary of goals, decisions, tool results, loaded capabilities, and remaining work. No fluff.',
          },
          { role: 'user', content: blob },
        ],
        { temperature: 0.2, maxTokens: 800 },
      )
      if (r.content.trim()) summary = r.content.trim()
    } catch {
      /* keep extractive summary */
    }
  }

  if (cfg.prune) {
    summary = summary.slice(0, 4000)
  }

  // recent keeps full tool_calls / tool_call_id so the FC chain stays valid
  const next: CompactableMessage[] = [
    ...head,
    {
      role: 'system',
      content: `## Context compaction\n${summary}`,
    },
    ...recent,
  ]
  return { messages: next, compacted: true, summary }
}
