export type PiCapability = { id: string; description: string; tools: string[]; runbook: string; deferLoading?: boolean }

export const DEFAULT_PI_CAPABILITIES: PiCapability[] = [
  { id: 'core-files', description: 'Read-only project file discovery and inspection.', tools: ['find', 'grep', 'ls', 'read'], runbook: 'Use project-scoped read tools before proposing edits.', deferLoading: true },
  { id: 'workspace-write', description: 'Workspace file edits.', tools: ['edit', 'write'], runbook: 'Review the target and preserve the approved project root.', deferLoading: true },
  { id: 'shell', description: 'Controlled project shell execution.', tools: ['bash'], runbook: 'Use the policy gate and ask before side effects.', deferLoading: true },
]

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
