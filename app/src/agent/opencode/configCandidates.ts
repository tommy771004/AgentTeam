/**
 * W3 / P0-C — Discovered OpenCode config as reviewable candidates.
 *
 * Every parsed field becomes exactly one of:
 *   temporary   — safely auto-applied for runs (instructions/compaction/agents…)
 *   review      — requires explicit user adoption (mcp servers, global model)
 *   unsupported — parsed file contains keys we do not project; listed, never silent
 *
 * Discovered values must NOT silently overwrite global Settings.
 */

export type CandidateApplyMode = 'temporary' | 'review' | 'unsupported'

/** Structural view of merged opencode config (loader type is not exported). */
export type MergedConfigView = {
  model?: string
  small_model?: string
  default_agent?: string
  permission?: Record<string, unknown>
  mcp?: Record<string, unknown>
  instructions?: string[]
  compaction?: Record<string, unknown> | undefined
}

export type DiscoveredConfigCandidate = {
  id: string
  /** e.g. 'instructions' | 'mcp.linear' | 'model' | 'permission' */
  field: string
  /** Human-readable preview */
  value: string
  /** File(s) the value came from */
  source: string
  trust: 'project' | 'global'
  applyMode: CandidateApplyMode
  /** temporary candidates are effective already (this session/run) */
  applied?: boolean
  /** review candidates the user adopted into Settings */
  adopted?: boolean
  note?: string
}

const KNOWN_KEYS = new Set([
  '$schema',
  'model',
  'small_model',
  'default_agent',
  'permission',
  'agent',
  'command',
  'mcp',
  'instructions',
  'compaction',
])

function trustOf(path: string): 'project' | 'global' {
  return /\.config|home|~|users\/[^/]+\/\.opencode/i.test(path) &&
    !/\/(src|app|repo|project)s?\//i.test(path)
    ? 'global'
    : 'project'
}

export function buildConfigCandidates(
  layers: Array<{ path: string; data: Record<string, unknown> }>,
  merged: MergedConfigView,
): DiscoveredConfigCandidate[] {
  const out: DiscoveredConfigCandidate[] = []
  const srcAll = layers.map((l) => l.path).join(' + ') || '(opencode config)'
  const trust = layers.length ? trustOf(layers[layers.length - 1].path) : 'project'

  if (merged.instructions?.length) {
    out.push({
      id: 'instructions',
      field: 'instructions',
      value: merged.instructions.join(', ').slice(0, 400),
      source: srcAll,
      trust,
      applyMode: 'temporary',
      applied: true,
      note: '本 run 暫時套用（注入專案指引層，不寫入全域設定）',
    })
  }
  if (merged.compaction && Object.keys(merged.compaction).length) {
    out.push({
      id: 'compaction',
      field: 'compaction',
      value: JSON.stringify(merged.compaction).slice(0, 200),
      source: srcAll,
      trust,
      applyMode: 'temporary',
      applied: true,
      note: '已由 compaction 模組消費',
    })
  }
  if (merged.small_model) {
    out.push({
      id: 'small_model',
      field: 'small_model',
      value: merged.small_model,
      source: srcAll,
      trust,
      applyMode: 'temporary',
      applied: true,
      note: '已由 agent registry 消費（摘要/壓縮用小模型）',
    })
  }
  if (merged.default_agent) {
    out.push({
      id: 'default_agent',
      field: 'default_agent',
      value: merged.default_agent,
      source: srcAll,
      trust,
      applyMode: 'temporary',
      applied: true,
      note: '已由 agent registry 消費',
    })
  }
  if (merged.permission && Object.keys(merged.permission).length) {
    out.push({
      id: 'permission',
      field: 'permission',
      value: JSON.stringify(merged.permission).slice(0, 300),
      source: srcAll,
      trust,
      applyMode: 'temporary',
      applied: true,
      note: '已由 agent registry 消費（Build/Plan 權限）；放寬全域權限仍需在設定手動調整',
    })
  }
  if (merged.model) {
    out.push({
      id: 'model',
      field: 'model',
      value: merged.model,
      source: srcAll,
      trust,
      applyMode: 'review',
      note: '採用後寫入全域預設模型（不自動覆蓋）',
    })
  }
  for (const [name, raw] of Object.entries(merged.mcp || {})) {
    out.push({
      id: `mcp.${name}`,
      field: `mcp.${name}`,
      value: JSON.stringify(raw).slice(0, 300),
      source: srcAll,
      trust,
      applyMode: 'review',
      note: '採用後加入 MCP 伺服器清單（secrets 不自動帶入）',
    })
  }

  // Unsupported keys — explicit, never silent
  for (const layer of layers) {
    for (const key of Object.keys(layer.data || {})) {
      if (KNOWN_KEYS.has(key)) continue
      out.push({
        id: `unsupported.${key}@${layer.path}`,
        field: key,
        value: JSON.stringify((layer.data as Record<string, unknown>)[key]).slice(0, 160),
        source: layer.path,
        trust: trustOf(layer.path),
        applyMode: 'unsupported',
        note: '本欄位目前未投影到 runtime — 不會生效',
      })
    }
  }

  return out
}

/**
 * Temporary prompt note for `instructions` entries (file paths or inline text).
 * File paths are surfaced for the agent to read via workspace_read (cwd = project).
 */
export function instructionsPromptNote(entries: string[] | undefined): string {
  if (!entries?.length) return ''
  const paths: string[] = []
  const inline: string[] = []
  for (const e of entries) {
    const s = String(e || '').trim()
    if (!s) continue
    if (/\s/.test(s) || s.length > 200) inline.push(s)
    else paths.push(s)
  }
  const parts: string[] = ['## OpenCode instructions（本 run 暫時套用）']
  if (paths.length) {
    parts.push(
      `下列檔案為專案指示，執行任務前請以 workspace_read 讀取並遵循：\n${paths
        .map((p) => `- ${p}`)
        .join('\n')}`,
    )
  }
  if (inline.length) {
    parts.push(inline.join('\n').slice(0, 4000))
  }
  return parts.length > 1 ? parts.join('\n') : ''
}

/** opencode mcp entry → app McpServerConfig fields (no secrets copied). */
export function mcpCandidateToServer(
  name: string,
  raw: unknown,
): {
  name: string
  transport: 'http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
} | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const url = typeof r.url === 'string' ? r.url : undefined
  if (url) return { name, transport: 'http', url }
  const cmd = r.command
  if (Array.isArray(cmd) && cmd.length) {
    return {
      name,
      transport: 'stdio',
      command: String(cmd[0]),
      args: cmd.slice(1).map(String),
    }
  }
  if (typeof cmd === 'string' && cmd.trim()) {
    const [head, ...rest] = cmd.trim().split(/\s+/)
    return { name, transport: 'stdio', command: head, args: rest }
  }
  return null
}
