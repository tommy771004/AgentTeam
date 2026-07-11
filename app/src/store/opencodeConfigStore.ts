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

  hydrate: (projectRoot?: string) => Promise<void>
  refresh: () => Promise<void>
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
}))
