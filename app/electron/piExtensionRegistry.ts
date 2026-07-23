export type PiExtensionKind = 'package' | 'mcp'

export type PiExtension = {
  id: string
  name: string
  version: string
  kind: PiExtensionKind
  source: string
  enabled: boolean
  trusted: boolean
  tools: string[]
  /** Credential identifiers only; raw tokens never cross the Host boundary. */
  credentialRefs: string[]
  mcp?: { command: string; args: string[]; env?: Record<string, string> }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(value)
}

function normalize(input: Record<string, unknown>, previous?: PiExtension): PiExtension {
  const id = input.id ?? previous?.id
  const name = input.name ?? previous?.name
  const version = input.version ?? previous?.version
  const kind = input.kind ?? previous?.kind
  const source = input.source ?? previous?.source
  if (!validId(id) || typeof name !== 'string' || !name.trim() || typeof version !== 'string' || !version.trim() || (kind !== 'package' && kind !== 'mcp') || typeof source !== 'string' || !source.trim()) {
    throw new Error('Pi extension requires id, name, version, kind, and source')
  }
  const tools = input.tools === undefined ? previous?.tools || [] : input.tools
  const credentialRefs = input.credentialRefs === undefined ? previous?.credentialRefs || [] : input.credentialRefs
  const mcpInput = input.mcp === undefined ? previous?.mcp : input.mcp
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool !== 'string') || !Array.isArray(credentialRefs) || credentialRefs.some((ref) => typeof ref !== 'string')) {
    throw new Error('Pi extension tools and credentialRefs must be string arrays')
  }
  if (kind === 'mcp' && (!mcpInput || typeof mcpInput !== 'object' || typeof (mcpInput as { command?: unknown }).command !== 'string' || !Array.isArray((mcpInput as { args?: unknown }).args) || (mcpInput as { args: unknown[] }).args.some((arg) => typeof arg !== 'string'))) {
    throw new Error('MCP extension requires command and args')
  }
  const result: PiExtension = {
    id,
    name: name.trim(),
    version: version.trim(),
    kind,
    source: source.trim(),
    enabled: input.enabled === undefined ? previous?.enabled ?? true : input.enabled === true,
    trusted: input.trusted === undefined ? previous?.trusted ?? false : input.trusted === true,
    tools: [...new Set(tools as string[])].sort(),
    credentialRefs: [...new Set(credentialRefs as string[])].sort(),
  }
  if (kind === 'mcp') {
    const config = mcpInput as { command: string; args: string[]; env?: Record<string, string> }
    result.mcp = { command: config.command, args: [...config.args], ...(config.env ? { env: { ...config.env } } : {}) }
  }
  return result
}

export class PiExtensionRegistry {
  private readonly extensions = new Map<string, PiExtension>()
  constructor(initial: PiExtension[] = []) { for (const extension of initial) this.extensions.set(extension.id, normalize(extension)) }
  list() { return [...this.extensions.values()].sort((a, b) => a.id.localeCompare(b.id)).map((extension) => ({ ...extension, tools: [...extension.tools], credentialRefs: [...extension.credentialRefs], ...(extension.mcp ? { mcp: { ...extension.mcp, args: [...extension.mcp.args], ...(extension.mcp.env ? { env: { ...extension.mcp.env } } : {}) } } : {}) })) }
  private clone(extension: PiExtension): PiExtension {
    return { ...extension, tools: [...extension.tools], credentialRefs: [...extension.credentialRefs], ...(extension.mcp ? { mcp: { ...extension.mcp, args: [...extension.mcp.args], ...(extension.mcp.env ? { env: { ...extension.mcp.env } } : {}) } } : {}) }
  }
  install(input: Record<string, unknown>) {
    const candidate = normalize(input)
    if (this.extensions.has(candidate.id)) throw new Error(`Pi extension already installed: ${candidate.id}`)
    this.extensions.set(candidate.id, candidate)
    return this.clone(candidate)
  }
  update(input: Record<string, unknown>) {
    const id = typeof input.id === 'string' ? input.id : ''
    const previous = this.extensions.get(id)
    if (!previous) throw new Error(`Unknown Pi extension: ${id}`)
    const next = normalize(input, previous)
    this.extensions.set(id, next)
    return this.clone(next)
  }
  setEnabled(id: string, enabled: boolean) {
    const previous = this.extensions.get(id)
    if (!previous) throw new Error(`Unknown Pi extension: ${id}`)
    previous.enabled = enabled
    return this.clone(previous)
  }
  uninstall(id: string) {
    if (!this.extensions.delete(id)) throw new Error(`Unknown Pi extension: ${id}`)
    return true
  }
}
