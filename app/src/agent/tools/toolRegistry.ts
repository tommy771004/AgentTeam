/**
 * Hermes-style tool registry: register + discover + dispatch metadata.
 *
 * - Per-tool modules under tools/registered/*.ts call register() at import time.
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

export function registryHandlersComplete(): boolean {
  ensureBuiltinRegistry()
  return Object.keys(TOOL_DEFINITIONS).every((n) => Boolean(_tools.get(n)?.handler))
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
  if (!entry?.handler) {
    return { ok: false, output: `Unknown or unregistered tool: ${name}` }
  }
  return entry.handler(args, ctx)
}
