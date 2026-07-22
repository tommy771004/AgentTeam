export type PiCapability = { id: string; description: string; tools: string[]; runbook: string; deferLoading?: boolean }

export class PiCapabilityCatalog {
  private readonly active = new Set<string>()
  private readonly capabilities: PiCapability[]
  constructor(capabilities: PiCapability[]) { this.capabilities = [...capabilities] }
  catalog() { return this.capabilities.map(({ id, description, deferLoading }) => ({ id, description, deferred: deferLoading === true && !this.active.has(id) })) }
  load(id: string): PiCapability {
    const capability = this.capabilities.find((candidate) => candidate.id === id)
    if (!capability) throw new Error(`Unknown capability: ${id}`)
    this.active.add(id)
    return { ...capability, tools: [...capability.tools] }
  }
  activeTools() { return this.capabilities.filter((capability) => this.active.has(capability.id)).flatMap((capability) => capability.tools).sort() }
  search(query: string) { return this.capabilities.filter((capability) => `${capability.id} ${capability.description} ${capability.tools.join(' ')}`.toLowerCase().includes(query.toLowerCase())).map((capability) => this.load(capability.id)) }
}
