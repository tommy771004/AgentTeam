/**
 * Structured chat history for prompts — prefer recent verbatim + compact older summary
 * instead of dumping 12 full messages (Hermes-style context budget).
 */

/**
 * Combined budget for "reference" context that lands in the same prompt slot:
 * intra-thread chat history (this module, built in runDispatch.ts) plus
 * cross-session recall (hermes/sessionSearch.ts, built later in engine.ts).
 * The two used to cap independently at ~6000 chars each with no shared
 * accounting — see docs/CONVERSATION_LOOP_HERMES_FLOW.md gap H6.
 */
export const REFERENCE_CONTEXT_BUDGET_CHARS = 6000
/** Fixed slice reserved for hermes/sessionSearch.ts's cross-session recall block. */
export const SESSION_RECALL_CONTEXT_CHARS = 1200
/** What chat history gets once session recall's reserved slice is set aside. */
export const CHAT_HISTORY_CONTEXT_CHARS = REFERENCE_CONTEXT_BUDGET_CHARS - SESSION_RECALL_CONTEXT_CHARS

export type ChatHistoryBubble = {
  role: string
  content: string
}

function firstLine(text: string, max = 140): string {
  const line = (text || '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

/**
 * Build a bounded history block for system context.
 * - ≤ keepRecent messages: full recent turns (capped per message)
 * - older turns: one-line bullets only
 */
export function buildChatHistoryContext(
  bubbles: ChatHistoryBubble[],
  opts?: {
    keepRecent?: number
    maxChars?: number
    perMessageChars?: number
  },
): string {
  const keepRecent = opts?.keepRecent ?? 3
  const maxChars = opts?.maxChars ?? CHAT_HISTORY_CONTEXT_CHARS
  const perMessage = opts?.perMessageChars ?? 600

  const chat = bubbles.filter((b) => b.role === 'user' || b.role === 'assistant')
  if (!chat.length) return ''

  if (chat.length <= keepRecent + 1) {
    const body = chat
      .map(
        (b) =>
          `${b.role === 'user' ? 'User' : 'Assistant'}: ${b.content.slice(0, perMessage)}`,
      )
      .join('\n')
    return `## 近期對話歷史（Reference chat history）\n${body}`.slice(0, maxChars)
  }

  const older = chat.slice(0, -keepRecent)
  const recent = chat.slice(-keepRecent)
  const summary = older
    .map(
      (b, i) =>
        `${i + 1}. ${b.role === 'user' ? 'User' : 'Assistant'}: ${firstLine(b.content)}`,
    )
    .join('\n')
  const recentBody = recent
    .map(
      (b) =>
        `${b.role === 'user' ? 'User' : 'Assistant'}: ${b.content.slice(0, perMessage)}`,
    )
    .join('\n')

  return [
    '## 對話摘要（較早輪次 · 濃縮）',
    summary,
    '',
    '## 近期對話（原文）',
    recentBody,
  ]
    .join('\n')
    .slice(0, maxChars)
}

/** User wants to resume the same Goal DoD rather than start a new parse. */
export function isContinueGoalPhrase(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  return /^(繼續|補齊|接著|再試|重試|繼續補|補上|continue\b|retry\b|keep going)/i.test(t)
}
