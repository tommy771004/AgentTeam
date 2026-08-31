import { createHash } from 'node:crypto'

/** Version of the Host-owned model-visible tool contract payload. */
export const PI_TOOL_CONTRACT_VERSION = 1 as const

export type PiToolContractSource = 'builtin' | 'extension-pack' | 'mcp' | 'pi-package'

/**
 * The compact catalog is deliberately separate from the full turn contract.
 * It carries the identity facts a UI needs without exposing model parameters.
 */
export type PiToolCatalogEntry = {
  name: string
  description: string
  pack: string
  source: 'discovered' | 'installed'
  active: boolean
  available: boolean
  reason?: string
  schemaDigest: string
  contractRevision?: number
  contractDigest?: string
  extensionId?: string
  upstreamToolName?: string
}

export type PiTurnToolContractTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  source: PiToolContractSource
  pack?: string
  extensionId?: string
  upstreamToolName?: string
  packageName?: string
  packageVersion?: string
  packageSource?: string
  resourceOrigin?: 'package'
  schemaDigest: string
  active: boolean
}

type PiMcpToolProvenance = { extensionId: string; upstreamToolName: string }
export type PiPackageToolProvenance = {
  packageName: string
  packageVersion: string
  packageSource: string
  resourceOrigin: 'package'
}
const mcpToolProvenance = new Map<string, PiMcpToolProvenance>()
const packageToolProvenance = new Map<string, PiPackageToolProvenance>()

/** Bind a native model-facing MCP name to the exact enabled upstream tool. */
export function registerPiMcpToolProvenance(name: string, provenance: PiMcpToolProvenance): void {
  mcpToolProvenance.set(name, Object.freeze({ ...provenance }))
}

export function registerPiPackageToolProvenance(sessionId: string, name: string, provenance: PiPackageToolProvenance): void {
  packageToolProvenance.set(`${sessionId}:${name}`, Object.freeze({ ...provenance }))
}

export function clearPiPackageToolProvenance(sessionId: string): void {
  for (const key of packageToolProvenance.keys()) if (key.startsWith(`${sessionId}:`)) packageToolProvenance.delete(key)
}

export type PiTurnToolContract = {
  version: typeof PI_TOOL_CONTRACT_VERSION
  sessionId: string
  revision: number
  tools: readonly PiTurnToolContractTool[]
  contractDigest: string
}

export type PiSessionToolDefinition = {
  name: string
  description?: string
  parameters?: unknown
  sourceInfo?: {
    source?: unknown
    path?: unknown
  }
}

export type PiSessionToolView = {
  getAllTools: () => readonly PiSessionToolDefinition[]
  getActiveToolNames: () => readonly string[]
}

/**
 * JSON canonicalization used for model-visible schema identity.
 *
 * Objects are sorted recursively while arrays retain their semantic order.
 * Undefined object properties are omitted exactly as JSON.stringify omits them.
 */
export function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalizeJson(object[key])]),
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function schemaDigest(schema: unknown): string {
  return createHash('sha256').update(canonicalJson(schema), 'utf8').digest('hex')
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child)
  return Object.freeze(value)
}

function extensionPackFromPath(path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined
  const match = /^<inline:subagents-(.+)>$/.exec(path)
  return match?.[1]
}

function sourceForTool(sessionId: string, definition: PiSessionToolDefinition): {
  source: PiToolContractSource
  pack?: string
  extensionId?: string
  upstreamToolName?: string
  packageName?: string
  packageVersion?: string
  packageSource?: string
  resourceOrigin?: 'package'
} {
  if (definition.sourceInfo?.source === 'builtin' || (typeof definition.sourceInfo?.path === 'string' && /^<builtin(?::[^>]+)?>$/.test(definition.sourceInfo.path))) {
    return { source: 'builtin' }
  }
  // The Host replaces only Pi's builtin write definition through the SDK seam
  // so the performing adapter can attach execution evidence. It remains the
  // builtin capability and contract, not an installed extension pack.
  if (definition.name === 'write' && definition.sourceInfo?.path === '<sdk:write>') {
    return { source: 'builtin' }
  }
  const pack = extensionPackFromPath(definition.sourceInfo?.path)
  const packageProvenance = packageToolProvenance.get(`${sessionId}:${definition.name}`)
  if (packageProvenance) return { source: 'pi-package', pack, ...packageProvenance }
  const mcp = mcpToolProvenance.get(definition.name)
  if (mcp) return { source: 'mcp', pack: pack || `mcp-${mcp.extensionId}`, ...mcp }
  return { source: 'extension-pack', ...(pack ? { pack } : {}) }
}

/**
 * Capture what a live Pi session has exposed to its model for this turn.
 * The caller supplies the session itself, never a renderer catalog.
 */
export function buildPiTurnToolContract(sessionId: string, revision: number, session: PiSessionToolView): PiTurnToolContract {
  const active = new Set(session.getActiveToolNames())
  const tools = session.getAllTools()
    .map((definition) => {
      const origin = sourceForTool(sessionId, definition)
      const parameters = (canonicalizeJson(definition.parameters || {}) || {}) as Record<string, unknown>
      return {
        name: definition.name,
        description: typeof definition.description === 'string' ? definition.description : '',
        parameters,
        ...origin,
        schemaDigest: schemaDigest(parameters),
        active: active.has(definition.name),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
  const contractDigest = schemaDigest(tools)
  return freezeDeep({
    version: PI_TOOL_CONTRACT_VERSION,
    sessionId,
    revision,
    tools,
    contractDigest,
  })
}

export type PiToolContractLookupError =
  | 'tool_contract_not_found'
  | 'tool_contract_unknown_tool'
  | 'tool_contract_stale'
  | 'tool_contract_session_mismatch'
  | 'tool_contract_inactive'

export type PiToolContractLookup =
  | { ok: true; contract: PiTurnToolContract; tool: PiTurnToolContractTool; status: 'current' | 'historical' }
  | { ok: false; code: PiToolContractLookupError; message: string }

/** Immutable in-process history of Host-issued contract revisions. */
export class PiToolContractStore {
  private readonly bySession = new Map<string, Map<number, PiTurnToolContract>>()
  private readonly nextRevisionBySession = new Map<string, number>()
  private readonly clearedThroughBySession = new Map<string, number>()

  constructor(initial: ReadonlyArray<PiTurnToolContract> = []) {
    for (const contract of initial) this.add(contract)
  }

  add(contract: PiTurnToolContract): void {
    if (!isPiTurnToolContract(contract)) return
    const session = this.bySession.get(contract.sessionId) || new Map<number, PiTurnToolContract>()
    session.set(contract.revision, freezeDeep(contract))
    this.bySession.set(contract.sessionId, session)
    this.nextRevisionBySession.set(contract.sessionId, Math.max(this.nextRevisionBySession.get(contract.sessionId) || 0, contract.revision + 1))
  }

  /** Keep a revision floor when history has been reset or loaded without its contracts. */
  reserveNextRevision(sessionId: string, nextRevision: number): void {
    if (!sessionId || !Number.isInteger(nextRevision) || nextRevision < 1) return
    this.nextRevisionBySession.set(sessionId, Math.max(this.nextRevisionBySession.get(sessionId) || 1, nextRevision))
  }

  nextRevision(sessionId: string): number {
    return this.nextRevisionBySession.get(sessionId) || 1
  }

  publish(sessionId: string, session: PiSessionToolView): PiTurnToolContract {
    const revision = this.nextRevisionBySession.get(sessionId) || 1
    const contract = buildPiTurnToolContract(sessionId, revision, session)
    this.add(contract)
    return contract
  }

  list(sessionId: string): readonly PiTurnToolContract[] {
    return [...(this.bySession.get(sessionId)?.values() || [])].sort((left, right) => left.revision - right.revision)
  }

  latest(sessionId: string): PiTurnToolContract | undefined {
    return this.list(sessionId).at(-1)
  }

  lookupCurrent(sessionId: string, toolName: string): PiToolContractLookup {
    const contract = this.latest(sessionId)
    if (!contract) {
      return { ok: false, code: 'tool_contract_not_found', message: `No current tool contract exists for session: ${sessionId}` }
    }
    return this.lookup(sessionId, contract.revision, toolName)
  }

  clear(sessionId: string): void {
    const contracts = this.bySession.get(sessionId)
    const clearedThrough = Math.max(this.clearedThroughBySession.get(sessionId) || 0, (this.nextRevisionBySession.get(sessionId) || 1) - 1, ...(contracts?.keys() || []))
    if (clearedThrough > 0) this.clearedThroughBySession.set(sessionId, clearedThrough)
    this.bySession.delete(sessionId)
  }

  lookup(sessionId: string, revision: number, toolName: string): PiToolContractLookup {
    if (!sessionId || !toolName || !Number.isInteger(revision) || revision < 1) {
      return { ok: false, code: 'tool_contract_not_found', message: 'sessionId, revision, and toolName are required' }
    }
    const contracts = this.bySession.get(sessionId)
    if (!contracts) {
      const clearedThrough = this.clearedThroughBySession.get(sessionId)
      return clearedThrough && revision <= clearedThrough
        ? { ok: false, code: 'tool_contract_stale', message: `Tool contract revision ${revision} was cleared from session ${sessionId}` }
        : { ok: false, code: 'tool_contract_session_mismatch', message: `No tool contract belongs to session: ${sessionId}` }
    }
    const contract = contracts.get(revision)
    if (!contract) {
      const latest = Math.max(...contracts.keys())
      return latest > revision
        ? { ok: false, code: 'tool_contract_stale', message: `Tool contract revision ${revision} is stale; latest is ${latest}` }
        : { ok: false, code: 'tool_contract_not_found', message: `Unknown tool contract revision ${revision} for session ${sessionId}` }
    }
    const tool = contract.tools.find((candidate) => candidate.name === toolName)
    if (!tool) return { ok: false, code: 'tool_contract_unknown_tool', message: `Unknown tool ${toolName} in contract revision ${revision}` }
    if (!tool.active) return { ok: false, code: 'tool_contract_inactive', message: `Tool ${toolName} was known but inactive in contract revision ${revision}` }
    return { ok: true, contract, tool, status: revision === Math.max(...contracts.keys()) ? 'current' : 'historical' }
  }
}

export function isPiTurnToolContract(value: unknown): value is PiTurnToolContract {
  if (!value || typeof value !== 'object') return false
  const contract = value as Partial<PiTurnToolContract>
  const revision = contract.revision
  if (contract.version !== PI_TOOL_CONTRACT_VERSION || typeof contract.sessionId !== 'string' || !contract.sessionId || typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1 || typeof contract.contractDigest !== 'string' || !/^[a-f0-9]{64}$/.test(contract.contractDigest) || !Array.isArray(contract.tools)) return false
  const tools = contract.tools as unknown[]
  if (tools.some((entry) => {
    if (!entry || typeof entry !== 'object') return true
    const tool = entry as Partial<PiTurnToolContractTool>
    const invalidBase = typeof tool.name !== 'string' || typeof tool.description !== 'string' || !tool.parameters || typeof tool.parameters !== 'object' || (tool.source !== 'builtin' && tool.source !== 'extension-pack' && tool.source !== 'mcp' && tool.source !== 'pi-package') || typeof tool.schemaDigest !== 'string' || !/^[a-f0-9]{64}$/.test(tool.schemaDigest) || typeof tool.active !== 'boolean' || tool.schemaDigest !== schemaDigest(tool.parameters)
    if (invalidBase) return true
    return tool.source === 'pi-package' && (typeof tool.packageName !== 'string' || !tool.packageName || typeof tool.packageVersion !== 'string' || !tool.packageVersion || typeof tool.packageSource !== 'string' || !tool.packageSource || tool.resourceOrigin !== 'package')
  })) return false
  return contract.contractDigest === schemaDigest(tools)
}
