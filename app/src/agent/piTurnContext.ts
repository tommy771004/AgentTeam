/**
 * The context a Pi Host turn is given, assembled in the renderer.
 *
 * Electron production dispatches the builtin turn straight to Pi Host
 * (runDispatch.ts). Pi Host recalls its own memory and discovers skills
 * through Pi's resource loader (ADR-0034), so this module now carries ONLY
 * what is not resource discovery: project guidance (AGENTS.md / CLAUDE.md),
 * recent chat history, and cross-session recall.
 *
 * The former skill-injection branch was the stopgap this effort scheduled
 * for removal (issue 18): it resolved renderer localStorage skills into
 * prompt text, which would calcify into a second discovery path beside Pi's
 * loader. Skills travel through the Host now — written to the Host-owned
 * directory, advertised by `<available_skills>`, expanded when pinned.
 */
import { buildChatHistoryContext, type ChatHistoryBubble } from './chatHistory.ts'
import { buildContextPacket, formatSessionRecallBlock, type ContextPacket } from './hermes/contextPacket.ts'
import { formatProjectGuidance, resolveProjectContext, summarizeProjectContext } from './projectContext.ts'
import type { ArchiveRecord, LlmSettings } from './types.ts'

export type PiTurnContextInput = {
  objective: string
  settings: LlmSettings
  projectRoot?: string
  /** Conversation so far, oldest first. The current objective may be the last entry. */
  bubbles?: ChatHistoryBubble[]
  /** Temporary chats read no memory and recall no other session. */
  temporary?: boolean
  /** Archive to recall across sessions; omitted when recall is off. */
  archive?: ArchiveRecord[]
}

export type PiTurnContext = {
  /** The packet text, empty when nothing applied. */
  assembled: string
  /** One-line provenance for the project guidance that applied. */
  projectGuidanceSummary: string
  packet: ContextPacket
}

/** Assemble the packet. Never throws: a turn with partial context beats no turn. */
export async function buildPiTurnContext(input: PiTurnContextInput): Promise<PiTurnContext> {
  const temporary = input.temporary === true
  const objective = input.objective.trim()

  let projectGuidance = ''
  let projectGuidanceSummary = ''
  try {
    const docs = await resolveProjectContext(input.projectRoot)
    projectGuidance = formatProjectGuidance(docs)
    projectGuidanceSummary = summarizeProjectContext(docs)
  } catch {
    /* Guidance is additive; a missing bridge must not fail the turn. */
  }

  const recentChat =
    input.settings.referenceChatHistory !== false && input.bubbles?.length
      ? buildChatHistoryContext(input.bubbles)
      : ''

  let sessionRecall = ''
  const recallOn = input.settings.sessionRecallEnabled !== false && !temporary
  if (recallOn && input.archive?.length) {
    try {
      const { searchSessions } = await import('./hermes/sessionSearch.ts')
      sessionRecall = formatSessionRecallBlock(searchSessions(objective, input.archive))
    } catch {
      /* recall is best-effort */
    }
  }

  const packet = buildContextPacket({
    projectGuidance,
    recentChat,
    sessionRecall,
    // Skills are Pi resources now (ADR-0034): the loader advertises them in
    // the system prompt, so no text travels here — one discovery path only.
    skillsContext: '',
    temporary,
    skipSessionRecall: !recallOn,
    sessionRecallSkipReason: temporary ? 'session recall omitted (temporary chat)' : 'session recall disabled',
    // Pi Host runs its own memory recall against Host-owned memories; adding
    // the renderer store here would inject a second, divergent copy.
    skipMemory: true,
    memorySkipReason: 'memory recalled by Pi Host',
  })

  return {
    assembled: packet.assembled,
    projectGuidanceSummary,
    packet,
  }
}

/**
 * Put the packet above the request.
 *
 * The objective goes last so the model reads the standing instructions first
 * and the thing being asked for immediately before it answers.
 */
export function withPiTurnContext(prompt: string, assembled: string, maxChars = 120_000): string {
  const context = assembled.trim()
  if (!context) return prompt
  return `${context}\n\n## 當前請求\n${prompt}`.slice(0, maxChars)
}
