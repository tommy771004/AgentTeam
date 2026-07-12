import type { EntityKind, KnowledgeEdge, KnowledgeEntity } from '../types'

export type OpenCodeLspOperation =
  | 'definition'
  | 'reference'
  | 'implementation'
  | 'incomingCalls'
  | 'outgoingCalls'

export type CodegraphLikeResult = {
  nodes: Array<{ id: string; name: string; kind: EntityKind; file?: string; line?: number }>
  edges: Array<{ from: string; to: string; label: string }>
  output: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function findList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const root = asRecord(value)
  if (!root) return []
  for (const key of ['items', 'results', 'locations', 'references', 'implementations', 'calls', 'value', 'data', 'result']) {
    const nested = root[key]
    if (Array.isArray(nested)) return nested
    if (nested && nested !== value) {
      const found = findList(nested)
      if (found.length) return found
    }
  }
  return []
}

function locationOf(value: Record<string, unknown>) {
  const location = asRecord(value.location) || asRecord(value.target) || value
  const uri = String(location.uri ?? location.path ?? location.file ?? location.filePath ?? '').trim()
  const range = asRecord(location.range) || asRecord(value.range)
  const start = asRecord(range?.start)
  const line = typeof start?.line === 'number' ? start.line + 1 : undefined
  return { uri, line }
}

function nameOf(value: Record<string, unknown>, fallback: string): string {
  const target = asRecord(value.target) || asRecord(value.item) || value
  return String(target.name ?? target.symbol ?? target.label ?? target.title ?? fallback).trim()
}

function operationLabel(operation: OpenCodeLspOperation): string {
  if (operation === 'definition') return 'defined_at'
  if (operation === 'reference') return 'referenced_at'
  if (operation === 'implementation') return 'implemented_by'
  return 'calls'
}

/** Convert OpenCode's experimental LSP tool result to the existing graph shape. */
export function mapOpenCodeLspToCodegraph(
  operation: OpenCodeLspOperation,
  symbol: string,
  payload: unknown,
): CodegraphLikeResult {
  const rootName = symbol.trim() || 'LSP target'
  const nodes: CodegraphLikeResult['nodes'] = [{ id: 'oc_root', name: rootName, kind: 'SYMBOL' }]
  const edges: CodegraphLikeResult['edges'] = []
  const seen = new Set<string>([rootName.toLowerCase()])
  for (const [index, raw] of findList(payload).entries()) {
    const item = asRecord(raw)
    if (!item) continue
    const loc = locationOf(item)
    const name = nameOf(item, `${operation} ${index + 1}`)
    const key = `${name.toLowerCase()}|${loc.uri}|${loc.line ?? ''}`
    if (!name || seen.has(key)) continue
    seen.add(key)
    const id = `oc_${index + 1}`
    nodes.push({ id, name: loc.line ? `${name} (${loc.uri}:${loc.line})` : loc.uri ? `${name} (${loc.uri})` : name, kind: 'SYMBOL', file: loc.uri || undefined, line: loc.line })
    const from = operation === 'incomingCalls' ? id : 'oc_root'
    const to = operation === 'incomingCalls' ? 'oc_root' : id
    edges.push({ from, to, label: operationLabel(operation) })
  }
  const output = [
    `OpenCode LSP · ${operation} · ${rootName}`,
    ...nodes.slice(1).map((node) => `- ${node.name}`),
  ].join('\n')
  return { nodes, edges, output }
}

export function mapOpenCodeLspToKnowledgeGraph(
  operation: OpenCodeLspOperation,
  symbol: string,
  payload: unknown,
): { entities: KnowledgeEntity[]; edges: KnowledgeEdge[]; output: string } {
  const mapped = mapOpenCodeLspToCodegraph(operation, symbol, payload)
  const entities: KnowledgeEntity[] = mapped.nodes.map((node, index) => ({
    id: node.id,
    name: node.name,
    kind: node.kind,
    mentions: 1,
    confidence: index === 0 ? 0.99 : 0.92,
  }))
  return { entities, edges: mapped.edges, output: mapped.output }
}
