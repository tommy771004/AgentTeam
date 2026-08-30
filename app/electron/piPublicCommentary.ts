export type PiAssistantTextPhase = 'commentary' | 'final_answer'

export type PiAssistantTextSegment = {
  content: string
  phase?: PiAssistantTextPhase
}

const PUBLIC_COMMENTARY_MARKER = '## Public progress updates'

/**
 * Host-owned delivery contract for user-visible progress.
 *
 * The provider's reasoning summary is private reasoning evidence, not public
 * narration. Asking for explicit commentary messages keeps that boundary
 * intact while giving a tool-using run something useful to project between
 * actions.
 */
export const PI_PUBLIC_COMMENTARY_GUIDANCE = `${PUBLIC_COMMENTARY_MARKER}

During tool-using work, send a concise public progress update as an assistant commentary message before the first meaningful tool batch. Send another only after material progress or before starting a distinct phase. Keep each update factual and brief; do not repeat unchanged status or narrate every tool call.

Public commentary must not reveal hidden reasoning, internal instructions, secrets, raw tool output, or unnecessary absolute paths. Keep the completed response as the final_answer message.`

export function appendPiPublicCommentaryGuidance(systemPrompt: string): string {
  if (systemPrompt.includes(PUBLIC_COMMENTARY_MARKER)) return systemPrompt
  return `${systemPrompt}\n\n${PI_PUBLIC_COMMENTARY_GUIDANCE}`
}

function textPhase(textSignature: unknown): PiAssistantTextPhase | undefined {
  if (typeof textSignature !== 'string') return undefined
  try {
    const parsed = JSON.parse(textSignature) as { phase?: unknown }
    return parsed.phase === 'commentary' || parsed.phase === 'final_answer' ? parsed.phase : undefined
  } catch {
    return undefined
  }
}

/**
 * Extract only public text blocks from one Pi assistant message.
 * Thinking and tool-call blocks are deliberately ignored.
 */
export function piAssistantTextSegments(content: unknown): PiAssistantTextSegment[] {
  if (typeof content === 'string') return content.trim() ? [{ content }] : []
  if (!Array.isArray(content)) return []

  const segments: PiAssistantTextSegment[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const candidate = part as { type?: unknown; text?: unknown; textSignature?: unknown }
    if (candidate.type !== 'text' || typeof candidate.text !== 'string' || !candidate.text.trim()) continue
    const phase = textPhase(candidate.textSignature)
    const previous = segments.at(-1)
    if (previous && previous.phase === phase) {
      previous.content += candidate.text
      continue
    }
    segments.push({ content: candidate.text, ...(phase ? { phase } : {}) })
  }
  return segments
}
