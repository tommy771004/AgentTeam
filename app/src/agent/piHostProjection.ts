export type PiProjectedMessage = { role: 'user' | 'assistant'; content: string }

export type PiSessionProjection = {
  id: string
  title: string
  threadId?: string
  messages: PiProjectedMessage[]
}

export type ProjectedThreadView = {
  threadId: string
  title: string
  bubbles: Array<{ id: string; role: 'user' | 'assistant'; content: string; at: string }>
}

/** Convert Host-owned history into a deterministic, disposable renderer view. */
export function projectPiSession(session: PiSessionProjection): ProjectedThreadView | null {
  if (!session.threadId) return null
  return {
    threadId: session.threadId,
    title: session.title,
    bubbles: session.messages.map((message, index) => ({
      id: `${session.id}:${index}`,
      role: message.role,
      content: message.content,
      // Host messages do not need renderer timestamps to remain canonical;
      // use the stable projection key so repeated snapshots are idempotent.
      at: `${session.id}:${index}`,
    })),
  }
}
