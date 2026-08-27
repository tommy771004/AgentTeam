export type PiMemory = { id: string; project?: string; text: string; tags: string[]; createdAt: string }

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])]
}

export class PiMemoryExtension {
  private memories: PiMemory[]
  constructor(initial: PiMemory[] = []) {
    this.memories = []
    this.import(initial)
  }
  add(memory: PiMemory) { this.memories = [...this.memories.filter((item) => item.id !== memory.id), { ...memory, tags: [...memory.tags] }] }
  delete(id: string) { this.memories = this.memories.filter((memory) => memory.id !== id) }
  clear() { this.memories = [] }
  recall(query: string, project?: string, limit = 5) {
    const queryTerms = terms(query)
    return this.memories
      // A memory without project scope is global. The old equality-only check
      // made every Settings memory disappear as soon as a project was active.
      .filter((memory) => !project || !memory.project || memory.project === project)
      .map((memory) => {
        const text = memory.text.toLowerCase()
        const tags = memory.tags.map((tag) => tag.toLowerCase())
        const matched = queryTerms.filter((term) => text.includes(term) || tags.some((tag) => tag.includes(term)))
        const exactTagMatches = queryTerms.filter((term) => tags.includes(term)).length
        const alwaysRecall = tags.includes('always-recall')
        const relevance = queryTerms.length ? matched.length / queryTerms.length + exactTagMatches * 0.25 : 0
        return { memory, score: alwaysRecall ? 2 + relevance : relevance }
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.createdAt.localeCompare(a.memory.createdAt))
      .slice(0, Math.max(1, Math.floor(limit)))
      .map(({ memory }) => ({ ...memory, tags: [...memory.tags] }))
  }
  export() { return this.memories.map((memory) => ({ ...memory, tags: [...memory.tags] })) }
  import(memories: PiMemory[]) { memories.forEach((memory) => this.add(memory)) }
}

export function isPiMemory(value: unknown): value is PiMemory {
  if (!value || typeof value !== 'object') return false
  const memory = value as Partial<PiMemory>
  return typeof memory.id === 'string' && memory.id.trim().length > 0
    && typeof memory.text === 'string'
    && Array.isArray(memory.tags) && memory.tags.every((tag) => typeof tag === 'string')
    && typeof memory.createdAt === 'string'
    && (memory.project === undefined || typeof memory.project === 'string')
}
