export type PiResource = { id: string; kind: 'skill' | 'prompt' | 'extension' | 'package'; source: string; enabled: boolean }

export class PiResourceRegistry {
  private resources = new Map<string, PiResource>()
  discover(resources: PiResource[]) { for (const resource of resources.sort((a, b) => a.id.localeCompare(b.id))) this.resources.set(resource.id, { ...resource }) }
  list() { return [...this.resources.values()].sort((a, b) => a.id.localeCompare(b.id)) }
  setEnabled(id: string, enabled: boolean) { const resource = this.resources.get(id); if (!resource) throw new Error(`Unknown Pi resource: ${id}`); resource.enabled = enabled }
  reload(resources: PiResource[]) { this.resources.clear(); this.discover(resources) }
}
