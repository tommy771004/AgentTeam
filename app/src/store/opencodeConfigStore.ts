/**
 * Hydrate OpenCode config into agent registry (global + project).
 */

import { create } from 'zustand'
import {
  agentsFromConfigJson,
  commandsFromConfigJson,
  mergeOpenCodeConfigs,
  type HydratedOpenCodeBundle,
} from '../agent/opencode/configLoader'
import type {
  OpenCodeAgentFileDef,
  OpenCodeCommandFileDef,
  OpenCodePermissionBlock,
} from '../agent/opencode/configTypes'
import { setHydratedOpenCodeConfig, listRegistryAgents } from '../agent/opencode/agentRegistry'
import type { RegistryAgent } from '../agent/opencode/agentRegistry'
import {
  buildConfigCandidates,
  instructionsPromptNote,
  mcpCandidateToServer,
  type DiscoveredConfigCandidate,
} from '../agent/opencode/configCandidates'
import { useProjectStore } from './projectStore'

interface OpenCodeConfigStore {
  loaded: boolean
  loading: boolean
  error: string | null
  sources: string[]
  model?: string
  small_model?: string
  default_agent?: string
  agents: RegistryAgent[]
  commands: OpenCodeCommandFileDef[]
  lastProjectRoot: string
  /** W3: every parsed field → temporary / review / unsupported（匯入報告） */
  candidates: DiscoveredConfigCandidate[]
  /** Raw instructions entries for lastProjectRoot (temporary-applied per run) */
  instructionsEntries: string[]
  /** Per-project instructions cache — avoids cross-project bleed when UI root ≠ run pin */
  instructionsByRoot: Record<string, string[]>

  hydrate: (projectRoot?: string) => Promise<void>
  refresh: () => Promise<void>
  /** Adopt a 'review' candidate into Settings (explicit human decision). */
  adoptCandidate: (id: string) => Promise<{ ok: boolean; message: string }>
  /**
   * Prompt note for temporary-applied instructions.
   * Pass projectRoot (run pin) so schedule A ≠ UI B does not mis-apply.
   */
  temporaryInstructionsNote: (projectRoot?: string) => string
}

function mapAgentFiles(raw: Array<Record<string, unknown>>): OpenCodeAgentFileDef[] {
  return (raw || []).map((a) => ({
    id: String(a.id || a.name || 'agent'),
    name: String(a.name || a.id || 'agent'),
    path: String(a.path || ''),
    mode: a.mode != null ? String(a.mode) : undefined,
    description: a.description != null ? String(a.description) : undefined,
    model: a.model != null ? String(a.model) : undefined,
    temperature: typeof a.temperature === 'number' ? a.temperature : undefined,
    steps: typeof a.steps === 'number' ? a.steps : undefined,
    body: String(a.body || ''),
    permission: a.permission as OpenCodePermissionBlock | undefined,
    hidden: a.hidden === true,
    color: a.color != null ? String(a.color) : undefined,
    source: (a.source as 'global' | 'project') || 'project',
  }))
}

function mapCommands(raw: Array<Record<string, unknown>>): OpenCodeCommandFileDef[] {
  return (raw || []).map((c) => ({
    id: String(c.id || c.name || 'cmd'),
    name: String(c.name || c.id || 'cmd'),
    path: String(c.path || ''),
    description: c.description != null ? String(c.description) : undefined,
    template: String(c.template || ''),
    agent: c.agent != null ? String(c.agent) : undefined,
    model: c.model != null ? String(c.model) : undefined,
    source: (c.source as 'global' | 'project' | 'config') || 'project',
  }))
}

export const useOpenCodeConfigStore = create<OpenCodeConfigStore>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  sources: [],
  agents: [],
  commands: [],
  lastProjectRoot: '',
  candidates: [],
  instructionsEntries: [],
  instructionsByRoot: {},

  hydrate: async (projectRoot) => {
    const root =
      projectRoot ?? useProjectStore.getState().root ?? ''
    set({ loading: true, error: null })
    try {
      if (!window.subagents?.opencode?.loadBundle) {
        // Fallback: builtin registry only
        setHydratedOpenCodeConfig(null)
        set({
          loaded: true,
          loading: false,
          agents: listRegistryAgents({ includeHidden: true }),
          commands: [],
          sources: [],
          lastProjectRoot: root,
          error: '非 Electron：僅內建 Build/Plan agent',
        })
        return
      }

      const bundle = await window.subagents.opencode.loadBundle(root || undefined)
      if (bundle.error) {
        set({ loading: false, error: bundle.error, loaded: true })
      }

      const merged = mergeOpenCodeConfigs(bundle.layers || [])
      const mdAgents = mapAgentFiles((bundle.agents || []) as Array<Record<string, unknown>>)
      const mdCmds = mapCommands((bundle.commands || []) as Array<Record<string, unknown>>)
      const jsonAgents = agentsFromConfigJson(merged.agent)
      const jsonCmds = commandsFromConfigJson(merged.command)

      const full: HydratedOpenCodeBundle = {
        ...merged,
        agentsFromMarkdown: [...mdAgents, ...jsonAgents],
        commandsFromMarkdown: [...mdCmds, ...jsonCmds],
        loadedAt: new Date().toISOString(),
        projectRoot: root,
      }
      setHydratedOpenCodeConfig(full)

      // W3: projection report — nothing parsed may silently disappear
      const prevAdopted = new Set(
        get()
          .candidates.filter((c) => c.adopted)
          .map((c) => c.id),
      )
      const candidates = buildConfigCandidates(
        (bundle.layers || []) as Array<{ path: string; data: Record<string, unknown> }>,
        merged,
      ).map((c) => (prevAdopted.has(c.id) ? { ...c, adopted: true } : c))

      const instructions = merged.instructions || []
      const byRoot = { ...get().instructionsByRoot }
      if (root) byRoot[root] = instructions

      set({
        loaded: true,
        loading: false,
        error: null,
        sources: full.sources,
        model: full.model,
        small_model: full.small_model,
        default_agent: full.default_agent,
        agents: listRegistryAgents({ includeHidden: true }),
        commands: full.commandsFromMarkdown,
        lastProjectRoot: root,
        candidates,
        instructionsEntries: instructions,
        instructionsByRoot: byRoot,
      })
    } catch (e) {
      set({
        loading: false,
        loaded: true,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  },

  refresh: async () => {
    await get().hydrate(get().lastProjectRoot)
  },

  adoptCandidate: async (id) => {
    const c = get().candidates.find((x) => x.id === id)
    if (!c) return { ok: false, message: `候選不存在：${id}` }
    if (c.applyMode !== 'review') {
      return { ok: false, message: `候選 ${id} 非待採用型（${c.applyMode}）` }
    }
    const { useSettingsStore } = await import('./settingsStore')
    const settings = useSettingsStore.getState()

    if (c.id === 'model') {
      await settings.update({ model: c.value })
      set({
        candidates: get().candidates.map((x) =>
          x.id === id ? { ...x, adopted: true } : x,
        ),
      })
      return { ok: true, message: `全域模型 → ${c.value}` }
    }

    if (c.id.startsWith('mcp.')) {
      const name = c.id.slice(4)
      let raw: unknown = null
      try {
        raw = JSON.parse(c.value)
      } catch {
        /* value preview may be truncated — re-read merged later */
      }
      const mapped = mcpCandidateToServer(name, raw)
      if (!mapped) {
        return { ok: false, message: `無法解析 MCP 候選 ${name}（command/url 缺失或被截斷）` }
      }
      const cur = settings.settings.mcpServers || []
      if (cur.some((s) => s.name === mapped.name)) {
        set({
          candidates: get().candidates.map((x) =>
            x.id === id ? { ...x, adopted: true } : x,
          ),
        })
        return { ok: true, message: `MCP「${name}」已存在，標記為已採用` }
      }
      await settings.update({
        mcpEnabled: true,
        mcpServers: [
          ...cur,
          {
            id: `oc_${name}_${Date.now().toString(36)}`,
            name: mapped.name,
            enabled: true,
            transport: mapped.transport,
            url: mapped.url,
            command: mapped.command,
            args: mapped.args,
          },
        ],
      })
      set({
        candidates: get().candidates.map((x) =>
          x.id === id ? { ...x, adopted: true } : x,
        ),
      })
      return { ok: true, message: `已加入 MCP 伺服器「${name}」（token 請自行補填）` }
    }

    return { ok: false, message: `未知的採用目標：${id}` }
  },

  temporaryInstructionsNote: (projectRoot) => {
    const root = (projectRoot || '').trim() || get().lastProjectRoot || ''
    const byRoot = get().instructionsByRoot
    const entries =
      (root && byRoot[root]) ||
      get().instructionsEntries ||
      []
    // If run pin differs from last hydrate and cache miss, note is empty (engine may re-hydrate)
    return instructionsPromptNote(entries)
  },
}))
