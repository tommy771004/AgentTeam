/**
 * Runtime projection used to frame recalled durable-memory entries.
 *
 * This is a value shape only. It owns no collection and cannot persist or
 * mutate memory; DurableMemoryStore remains the sole production authority.
 */
export type PiMemory = {
  id: string
  project?: string
  text: string
  tags: string[]
  createdAt: string
}

/** Legacy JSON and persisted run-candidate validation only. */
export function isLegacyPiMemory(value: unknown): value is PiMemory {
  if (!value || typeof value !== 'object') return false
  const memory = value as Partial<PiMemory>
  return typeof memory.id === 'string' && memory.id.trim().length > 0
    && typeof memory.text === 'string'
    && Array.isArray(memory.tags) && memory.tags.every((tag) => typeof tag === 'string')
    && typeof memory.createdAt === 'string'
    && (memory.project === undefined || typeof memory.project === 'string')
}
