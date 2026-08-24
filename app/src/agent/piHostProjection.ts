/**
 * One message as the Host holds it. `tool` entries are the agent's own action
 * trace: real history the model reads, but not a chat bubble — the renderer
 * drops them until the Turn Record gets a row of its own.
 */
export type PiProjectedMessage = { role: 'user' | 'assistant' | 'tool'; content: string }

export type PiSessionProjection = {
  id: string
  title: string
  threadId?: string
  /** Host tombstone. An archived session is deleted history, not hidden history. */
  archived?: boolean
  messages: PiProjectedMessage[]
}

export type ProjectedThreadView = {
  threadId: string
  title: string
  bubbles: Array<{ id: string; role: 'user' | 'assistant'; content: string; at: string }>
}

/**
 * Convert Host-owned history into a deterministic, disposable renderer view.
 * Archived sessions project to `null`: the Host keeps the record for audit, but
 * the renderer must never resurrect a thread the user deleted.
 */
export function projectPiSession(session: PiSessionProjection): ProjectedThreadView | null {
  if (!session.threadId || session.archived) return null
  return {
    threadId: session.threadId,
    title: session.title,
    bubbles: session.messages
      .filter((message): message is { role: 'user' | 'assistant'; content: string } => message.role !== 'tool')
      .map((message, index) => ({
      id: `${session.id}:${index}`,
      role: message.role,
      content: message.content,
      // Host messages do not need renderer timestamps to remain canonical;
      // use the stable projection key so repeated snapshots are idempotent.
      at: `${session.id}:${index}`,
    })),
  }
}
