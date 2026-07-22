export type PiMemory = { id: string; project?: string; text: string; tags: string[]; createdAt: string }

export class PiMemoryExtension {
  private memories: PiMemory[] = []
  add(memory: PiMemory) { this.memories = [...this.memories.filter((item) => item.id !== memory.id), { ...memory, tags: [...memory.tags] }] }
  recall(query: string, project?: string, limit = 5) {
    const q = query.toLowerCase()
    return this.memories.filter((memory) => (!project || memory.project === project) && `${memory.text} ${memory.tags.join(' ')}`.toLowerCase().includes(q)).slice(0, limit).map((memory) => ({ ...memory, tags: [...memory.tags] }))
  }
  export() { return this.memories.map((memory) => ({ ...memory, tags: [...memory.tags] })) }
  import(memories: PiMemory[]) { memories.forEach((memory) => this.add(memory)) }
}
