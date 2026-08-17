/**
 * Renderer helpers for CodeGraph integration
 * @see https://github.com/colbymchenry/codegraph
 */

import type { EntityKind, KnowledgeEdge, KnowledgeEntity, KnowledgeGraph } from './types.ts'
import { mapOpenCodeLspToKnowledgeGraph, type OpenCodeLspOperation } from './opencode/codeIntelligenceAdapter.ts'

/** Translate an OpenCode experimental LSP result into the existing CodeGraph view. */
export function parseOpenCodeLspToGraph(
  operation: OpenCodeLspOperation,
  symbol: string,
  payload: unknown,
): KnowledgeGraph {
  const mapped = mapOpenCodeLspToKnowledgeGraph(operation, symbol, payload)
  return {
    entities: mapped.entities.slice(0, 50),
    edges: mapped.edges.slice(0, 80),
    phase: `OpenCode LSP · ${operation}`,
    source: 'codegraph',
  }
}

export type CodegraphUiStatus = {
  installed: boolean
  binaryPath: string | null
  projectRoot: string
  indexed: boolean
  indexPath: string | null
  version: string | null
  raw: string
  error?: string
}

export type CodegraphCmdResult = {
  ok: boolean
  query: string
  projectRoot: string
  output: string
  json?: unknown
  error?: string
  command: string
}

type LooseNode = {
  id?: string
  name?: string
  kind?: string
  type?: string
  file?: string
  path?: string
  filePath?: string
  symbol?: string
  label?: string
  fqname?: string
  qualifiedName?: string
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['nodes', 'results', 'items', 'symbols', 'callers', 'callees', 'affected']) {
      if (Array.isArray(o[k])) return o[k] as unknown[]
    }
    if (o.node && typeof o.node === 'object') return [o.node]
  }
  return []
}

function nodeName(n: LooseNode): string {
  return (
    n.name ||
    n.symbol ||
    n.fqname ||
    n.qualifiedName ||
    n.label ||
    n.file ||
    n.path ||
    n.filePath ||
    ''
  ).trim()
}

function nodeKind(n: LooseNode): EntityKind {
  const k = (n.kind || n.type || '').toLowerCase()
  if (k.includes('file') || n.file || n.path || n.filePath) {
    if (!n.name && (n.file || n.path || n.filePath)) return 'FILE'
  }
  if (
    /file|module|path/.test(k) ||
    /\.(ts|tsx|js|jsx|py|go|rs|java|vue|svelte|md)$/i.test(nodeName(n))
  ) {
    return 'FILE'
  }
  if (/class|function|method|symbol|interface|type|struct|enum|const|var/.test(k)) {
    return 'SYMBOL'
  }
  if (n.file || n.path || n.filePath) return 'SYMBOL'
  return 'SYMBOL'
}

/** Build graph from CodeGraph JSON and/or text output */
export function parseCodegraphToGraph(
  output: string,
  query: string,
  json?: unknown,
): KnowledgeGraph {
  const entities: KnowledgeEntity[] = []
  const edges: KnowledgeEdge[] = []
  const seen = new Map<string, KnowledgeEntity>()
  let i = 0

  const push = (name: string, kind: EntityKind, conf = 0.9, idHint?: string) => {
    const key = name.toLowerCase()
    if (!name || name.length < 1 || name.length > 160) return null
    if (seen.has(key)) return seen.get(key)!
    const ent: KnowledgeEntity = {
      id: idHint || `cg_${i++}`,
      name: name.slice(0, 120),
      kind,
      mentions: 1,
      confidence: conf,
    }
    seen.set(key, ent)
    entities.push(ent)
    return ent
  }

  // Prefer JSON structure
  if (json != null) {
    const nodes = asArray(json)
    const idMap = new Map<string, string>() // external id -> our id

    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') {
        if (typeof raw === 'string') push(raw, 'SYMBOL', 0.8)
        continue
      }
      const n = raw as LooseNode
      // sometimes nested { node: {...} }
      const node = (n as { node?: LooseNode }).node || n
      const name = nodeName(node)
      if (!name) continue
      const ent = push(name, nodeKind(node), 0.92, node.id ? `cg_${node.id}` : undefined)
      if (ent && node.id) idMap.set(String(node.id), ent.id)
      // file companion
      const fp = node.file || node.path || node.filePath
      if (fp && ent) {
        const fileEnt = push(String(fp), 'FILE', 0.95)
        if (fileEnt) {
          edges.push({ from: ent.id, to: fileEnt.id, label: 'defined_in' })
        }
      }
    }

    // edges array if present
    if (json && typeof json === 'object' && !Array.isArray(json)) {
      const o = json as Record<string, unknown>
      const rawEdges = Array.isArray(o.edges) ? o.edges : []
      for (const e of rawEdges) {
        if (!e || typeof e !== 'object') continue
        const ed = e as { from?: string; to?: string; source?: string; target?: string; label?: string; type?: string }
        const from = idMap.get(String(ed.from || ed.source || '')) || String(ed.from || ed.source || '')
        const to = idMap.get(String(ed.to || ed.target || '')) || String(ed.to || ed.target || '')
        if (from && to && seen.has(from) === false) {
          // might be entity ids we created with cg_ prefix
        }
        const fromId =
          idMap.get(String(ed.from || ed.source || '')) ||
          entities.find((x) => x.id === String(ed.from || ed.source))?.id
        const toId =
          idMap.get(String(ed.to || ed.target || '')) ||
          entities.find((x) => x.id === String(ed.to || ed.target))?.id
        if (fromId && toId) {
          edges.push({
            from: fromId,
            to: toId,
            label: ed.label || ed.type || 'related',
          })
        }
      }
    }
  }

  // Text heuristics when JSON sparse
  if (entities.length < 3 && output) {
    const pathRe =
      /(?:^|[\s`"'(])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|swift|vue|svelte|md))(?::\d+)?/gm
    const symbolRe =
      /\b([A-Z][A-Za-z0-9_]{1,48}(?:[.#][A-Za-z0-9_]+){0,3})\b/g
    const callRe =
      /(?:calls?|caller|callee|imports?|extends|implements|→|->)\s+[`']?([A-Za-z_][\w.#]*)/gi

    let m: RegExpExecArray | null
    while ((m = pathRe.exec(output)) !== null) push(m[1], 'FILE', 0.95)
    while ((m = symbolRe.exec(output)) !== null) {
      if (!/^(The|This|With|From|That|When|How|And|For|File|Line|Type|Name)$/i.test(m[1])) {
        push(m[1], 'SYMBOL', 0.85)
      }
    }
    while ((m = callRe.exec(output)) !== null) push(m[1], 'SYMBOL', 0.92)
  }

  if (query.trim()) push(query.trim().slice(0, 80), 'CONCEPT', 0.99)

  const limited = entities.slice(0, 50)
  const hub = limited[0]
  if (hub && edges.length < 3) {
    for (const e of limited.slice(1, 18)) {
      edges.push({
        from: hub.id,
        to: e.id,
        label:
          e.kind === 'FILE' ? 'in_file' : e.kind === 'SYMBOL' ? 'related_symbol' : 'related',
      })
    }
  }
  for (let j = 1; j < Math.min(limited.length, 10) && edges.length < 40; j++) {
    edges.push({ from: limited[j - 1].id, to: limited[j].id, label: 'context' })
  }

  return {
    entities: limited,
    edges: edges.slice(0, 80),
    phase: limited.length
      ? `CodeGraph · ${query.slice(0, 48) || 'explore'}`
      : 'CodeGraph · empty',
    source: 'codegraph',
  }
}

/** @deprecated use parseCodegraphToGraph */
export function parseCodegraphOutputToGraph(
  output: string,
  query: string,
): KnowledgeGraph {
  return parseCodegraphToGraph(output, query)
}

export function mergeKnowledgeGraphs(
  task: KnowledgeGraph,
  code: KnowledgeGraph,
): KnowledgeGraph {
  const entities = [...(task.entities || [])]
  const edges = [...(task.edges || [])]
  const seen = new Set(entities.map((e) => e.name.toLowerCase()))
  for (const e of code.entities || []) {
    if (seen.has(e.name.toLowerCase())) continue
    seen.add(e.name.toLowerCase())
    entities.push(e)
  }
  const ids = new Set(entities.map((e) => e.id))
  for (const ed of code.edges || []) {
    if (ids.has(ed.from) && ids.has(ed.to)) edges.push(ed)
  }
  return {
    entities: entities.slice(0, 80),
    edges: edges.slice(0, 100),
    phase: 'Merged · task+codegraph',
    source: 'merged',
  }
}

export async function fetchCodegraphStatus(
  projectRoot?: string,
): Promise<CodegraphUiStatus | null> {
  if (!window.subagents?.codegraph?.status) return null
  return window.subagents.codegraph.status(projectRoot)
}

async function applyGraphToAgent(graph: KnowledgeGraph) {
  try {
    const { useAgentStore } = await import('../store/agentStore.ts')
    const cur = useAgentStore.getState().agent
    const merged = mergeKnowledgeGraphs(
      cur.knowledge || { entities: [], edges: [], phase: 'Idle' },
      graph,
    )
    useAgentStore.setState({
      agent: { ...cur, knowledge: merged },
    })
    return merged
  } catch {
    return graph
  }
}

export async function runCodegraphExplore(
  projectRoot: string,
  query: string,
): Promise<{
  ok: boolean
  output: string
  graph: KnowledgeGraph
  error?: string
  merged?: KnowledgeGraph
}> {
  if (!window.subagents?.codegraph?.explore) {
    return {
      ok: false,
      output: '',
      graph: { entities: [], edges: [], phase: 'Idle', source: 'codegraph' },
      error: 'CodeGraph API 不可用（需 Electron + preload）',
    }
  }
  const r = await window.subagents.codegraph.explore({ projectRoot, query })
  const graph = parseCodegraphToGraph(r.output || '', query, r.json)
  const merged = r.ok ? await applyGraphToAgent(graph) : undefined
  return {
    ok: r.ok,
    output: r.output,
    graph,
    error: r.error,
    merged,
  }
}

export async function runCodegraphImpact(
  projectRoot: string,
  symbol: string,
  depth = 2,
): Promise<{
  ok: boolean
  output: string
  graph: KnowledgeGraph
  error?: string
  merged?: KnowledgeGraph
}> {
  if (!window.subagents?.codegraph?.impact) {
    return {
      ok: false,
      output: '',
      graph: { entities: [], edges: [], phase: 'Idle', source: 'codegraph' },
      error: 'CodeGraph impact API 不可用',
    }
  }
  const r = await window.subagents.codegraph.impact({
    projectRoot,
    symbol,
    depth,
    json: true,
  })
  const graph = parseCodegraphToGraph(r.output || '', `impact:${symbol}`, r.json)
  graph.phase = `CodeGraph impact · ${symbol}`
  const merged = r.ok ? await applyGraphToAgent(graph) : undefined
  return { ok: r.ok, output: r.output, graph, error: r.error, merged }
}

export async function runCodegraphCallers(
  projectRoot: string,
  symbol: string,
): Promise<{
  ok: boolean
  output: string
  graph: KnowledgeGraph
  error?: string
  merged?: KnowledgeGraph
}> {
  if (!window.subagents?.codegraph?.callers) {
    return {
      ok: false,
      output: '',
      graph: { entities: [], edges: [], phase: 'Idle', source: 'codegraph' },
      error: 'CodeGraph callers API 不可用',
    }
  }
  const r = await window.subagents.codegraph.callers({
    projectRoot,
    symbol,
    json: true,
  })
  const graph = parseCodegraphToGraph(r.output || '', `callers:${symbol}`, r.json)
  graph.phase = `CodeGraph callers · ${symbol}`
  // hub edges labeled calls
  if (graph.entities[0]) {
    for (const e of graph.entities.slice(1, 20)) {
      graph.edges.push({ from: e.id, to: graph.entities[0].id, label: 'calls' })
    }
  }
  const merged = r.ok ? await applyGraphToAgent(graph) : undefined
  return { ok: r.ok, output: r.output, graph, error: r.error, merged }
}
