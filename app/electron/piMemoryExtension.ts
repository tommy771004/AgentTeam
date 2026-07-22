export type PiMemory = { id: string; project?: string; text: string; tags: string[]; createdAt: string }

export class PiMemoryExtension {
  private memories: PiMemory[]
  constructor(initial: PiMemory[] = []) {
    this.memories = []
    this.import(initial)
  }
  add(memory: PiMemory) { this.memories = [...this.memories.filter((item) => item.id !== memory.id), { ...memory, tags: [...memory.tags] }] }
  recall(query: string, project?: string, limit = 5) {
    const q = query.toLowerCase()
    return this.memories.filter((memory) => (!project || memory.project === project) && `${memory.text} ${memory.tags.join(' ')}`.toLowerCase().includes(q)).slice(0, limit).map((memory) => ({ ...memory, tags: [...memory.tags] }))
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
