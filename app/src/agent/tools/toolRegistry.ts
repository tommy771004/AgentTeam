/**
 * Hermes-style tool registry: register + discover + dispatch metadata.
 *
 * - The five non-equivalent workspace compatibility modules call register()
 *   at import time. Every production tool is owned by Pi Core Host.
 * - ensureBuiltinRegistry() seeds any missing names from TOOL_DEFINITIONS (safety net).
 * - Catalog views are derived from the registry map (authority after seed+discover).
 */
import type { ToolName } from './toolDefinitions.ts'
import { TOOL_DEFINITIONS, toolCatalogEntries } from './toolDefinitions.ts'

export type ToolRegistryHandler = (
  args: Record<string, unknown>,
  ctx?: Record<string, unknown>,
) => Promise<{ ok: boolean; output: string }> | { ok: boolean; output: string }

export type ToolRegistryEntry = {
  name: string
  toolset: string
  description: string
  keywords: string[]
  schemaParams: Record<string, unknown>
  handler?: ToolRegistryHandler
  owningCapability?: string
}

const _tools = new Map<string, ToolRegistryEntry>()
let _seeded = false
let _discovered = false

export function register(entry: ToolRegistryEntry): void {
  _tools.set(entry.name, entry)
}

export function getRegistryEntry(name: string): ToolRegistryEntry | undefined {
  ensureBuiltinRegistry()
  return _tools.get(name)
}

export function getRegistryToolNames(): string[] {
  ensureBuiltinRegistry()
  return [..._tools.keys()].sort()
}

export function getRegistryCatalog(): Array<{
  name: string
  description: string
  keywords: string[]
}> {
  ensureBuiltinRegistry()
  return [..._tools.values()].map((e) => ({
    name: e.name,
    description: e.description,
    keywords: e.keywords,
  }))
}

export function registryCoversToolDefinitions(): boolean {
  ensureBuiltinRegistry()
  return Object.keys(TOOL_DEFINITIONS).every((n) => _tools.has(n))
}

/**
 * Tools the Pi Core Host now OWNS outright (ADR-0027 removal, issues 14/15).
 *
 * Their renderer handler modules are deleted after parity evidence, so the
 * seeded definition entries intentionally carry no handler. This list is the
 * drift guard's contract: a name here without a Host-side counterpart, or a
 * NEW renderer registration for any of them, must fail the build. Everything
 * outside this list still requires its own handler module.
 */
export const RENDERER_FALLBACK_TOOL_NAMES: ReadonlySet<string> = new Set([
  'workspace_diff',
  'workspace_download',
  'workspace_mkdir',
  'workspace_move',
  'workspace_delete',
])

export const HOST_OWNED_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(TOOL_DEFINITIONS).filter((name) => !RENDERER_FALLBACK_TOOL_NAMES.has(name)),
)

export function registryHandlersComplete(): boolean {
  ensureBuiltinRegistry()
  return Object.keys(TOOL_DEFINITIONS).every((n) => {
    if (RENDERER_FALLBACK_TOOL_NAMES.has(n)) return Boolean(_tools.get(n)?.handler)
    return !_tools.get(n)?.handler
  })
}

/** Seed missing entries from TOOL_DEFINITIONS (no handlers — modules supply those). */
export function ensureBuiltinRegistry(): void {
  if (_seeded) return
  _seeded = true
  for (const row of toolCatalogEntries()) {
    if (_tools.has(row.name)) continue
    const def = TOOL_DEFINITIONS[row.name as ToolName]
    register({
      name: row.name,
      toolset: def?.owningCapability || 'builtin',
      description: row.description,
      keywords: row.keywords,
      schemaParams: (def?.parameters || {}) as Record<string, unknown>,
      owningCapability: def?.owningCapability,
    })
  }
}

/** Import all self-registering tool modules (Hermes discover). */
export async function discoverRegisteredToolModules(): Promise<string[]> {
  if (_discovered) return ['tools/registered/*']
  _discovered = true
  ensureBuiltinRegistry()
  await import('./registered/index.ts')
  return getRegistryToolNames().map((n) => `tools/registered/${n}`)
}

/** Dispatch via registered handler when present. */
export async function dispatchRegistered(
  name: string,
  args: Record<string, unknown>,
  ctx?: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  await discoverRegisteredToolModules()
  const entry = _tools.get(name)
  if (HOST_OWNED_TOOL_NAMES.has(name) && !entry?.handler) {
    // ADR-0027 removal: the Host owns this tool now. The honest answer names
    // the owner instead of pretending the renderer can still run it.
    return { ok: false, output: `${name} 已由 Pi Core Host 接管：請改用 Host 的同名 builtin 工具` }
  }
  if (!entry?.handler) {
    return { ok: false, output: `Unknown or unregistered tool: ${name}` }
  }
  return entry.handler(args, ctx)
}
