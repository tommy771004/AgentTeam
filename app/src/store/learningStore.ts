import { create } from 'zustand'
import { memoryStore } from '../agent/hermes/memory'
import { skillsStore } from '../agent/hermes/skills'
import { learningLoop } from '../agent/hermes/learning'
import { searchSessions, summarizeSessionHits } from '../agent/hermes/sessionSearch'
import { getAgentsDoc, getSoulDoc, setAgentsDoc, setSoulDoc } from '../agent/hermes/promptBuilder'
import { pluginRegistry, type PluginManifest } from '../agent/hermes/plugins'
import { PLUGIN_CATALOG, catalogItem, type PluginCatalogItem } from '../agent/hermes/pluginCatalog'
import {
  accountHintFromToken,
  clearPluginSecret,
  hasPluginSecret,
  setPluginSecret,
} from '../agent/hermes/pluginSecrets'
import { oauthProviderForPlugin } from '../agent/hermes/pluginOAuth'
import {
  refreshDueTokens,
  startPluginTokenRefreshScheduler,
  stopPluginTokenRefreshScheduler,
} from '../agent/hermes/pluginTokenRefresh'
import type { LearningEvent, MemoryBundle, SessionSearchHit, Skill } from '../agent/hermes/types'
import type { ArchiveRecord } from '../agent/types'
import { useSettingsStore } from './settingsStore'

export type PluginHealth = {
  ok: boolean
  status: 'ready' | 'error' | 'setup-required' | 'not-installed'
  toolCount?: number
  error?: string
}

type PluginLifecycleApi = {
  save?: (manifest: PluginManifest) => Promise<{ ok: boolean; path: string }>
  delete?: (id: string) => Promise<{ ok: boolean }>
  install?: (input: { id: string; projectRoot?: string }) => Promise<{
    ok: boolean
    manifest?: PluginManifest
    error?: string
    requiresSetup?: boolean
    log?: string
  }>
  health?: (id: string) => Promise<
    {
      ok: boolean
      status?: PluginHealth['status']
      toolCount?: number
      error?: string
      installed?: boolean
      healthy?: boolean
      tools?: unknown[]
    }
  >
  uninstall?: (id: string) => Promise<{ ok: boolean; error?: string }>
}

function pluginApi(): PluginLifecycleApi | undefined {
  return window.subagents?.plugins as unknown as PluginLifecycleApi | undefined
}

interface LearningStore {
  loaded: boolean
  memory: MemoryBundle
  skills: Skill[]
  events: LearningEvent[]
  pendingDrafts: Array<{ name: string; description: string; body: string }>
  soul: string
  agents: string
  searchHits: SessionSearchHit[]
  searchSummary: string | null
  plugins: PluginManifest[]
  catalog: PluginCatalogItem[]
  installingPluginId: string | null
  pluginHealth: Record<string, PluginHealth>
  pluginError: string | null

  load: () => Promise<void>
  persist: () => Promise<void>
  refresh: () => void
  setUserProfile: (text: string) => Promise<void>
  setMemoryDoc: (text: string) => Promise<void>
  appendMemory: (text: string) => Promise<void>
  deleteMemoryEntry: (id: string) => Promise<void>
  clearMemories: () => Promise<void>
  setSoul: (text: string) => Promise<void>
  setAgents: (text: string) => Promise<void>
  approveDraft: (name: string) => Promise<void>
  rejectDraft: (name: string) => void
  search: (query: string, archive: ArchiveRecord[]) => Promise<void>
  saveSkill: (name: string, description: string, body: string) => Promise<void>
  restoreSkill: (name: string) => Promise<void>
  removeSkill: (name: string) => Promise<void>
  setPluginEnabled: (id: string, enabled: boolean) => Promise<void>
  importPlugin: (manifest: PluginManifest) => Promise<void>
  removePlugin: (id: string) => Promise<void>
  installPlugin: (id: string, projectRoot?: string) => Promise<void>
  checkPlugin: (id: string) => Promise<PluginHealth>
  /** Save connector PAT/API key/OAuth access token (secret store + manifest meta). */
  authorizePlugin: (
    id: string,
    token: string,
    extra?: { refreshToken?: string; expiresIn?: number; tokenType?: string },
  ) => Promise<void>
  clearPluginAuth: (id: string) => Promise<void>
  /**
   * Electron OAuth (device code or loopback code flow).
   * Saves client credentials into settings.pluginOAuthClients when provided.
   */
  runPluginOAuth: (
    id: string,
    client: { clientId: string; clientSecret?: string },
  ) => Promise<{ ok: boolean; error?: string }>
  /** Refresh all due OAuth access tokens (uses refresh_token + client credentials). */
  refreshPluginTokens: () => Promise<number>
  /** Start background refresh timer (idempotent). */
  startTokenRefreshScheduler: () => void
  stopTokenRefreshScheduler: () => void
  /** Re-bind npm-mcp ${projectRoot} args after project switch. */
  rebindPluginProjectRoots: (projectRoot: string) => Promise<void>
  applyPlugins: () => void
  /** P1-C: approve a tool package's privilege fingerprint (unlocks withheld tools). */
  approveToolPackage: (pluginId: string) => Promise<{ ok: boolean; message: string }>
}

/**
 * Normalize MCP server ownership fields:
 * - pluginId = package that owns the process (for merge/filter)
 * - secretPluginId = token owner (connector / dsn), preserved across sync
 */
function normalizePluginMcpServer(
  server: NonNullable<PluginManifest['mcpServers']>[number],
  packagePluginId: string,
  packageSecretPluginId?: string,
) {
  const secretPluginId =
    server.secretPluginId ||
    packageSecretPluginId ||
    // Legacy installs wrongly stored connector id on pluginId — keep as secret owner
    (server.pluginId && server.pluginId !== packagePluginId ? server.pluginId : undefined) ||
    packagePluginId
  return {
    ...server,
    pluginId: packagePluginId,
    secretPluginId,
  }
}

async function syncPluginMcpServers() {
  const plugins = pluginRegistry.list()
  const ownedServerIds = new Set<string>()
  const pluginServers = plugins.flatMap((plugin) => {
    if (!plugin.enabled) return []
    const packageSecret =
      (plugin as { secretPluginId?: string }).secretPluginId ||
      catalogItem(plugin.id)?.npm?.secretPluginId ||
      catalogItem(plugin.id)?.dependsOnPluginId
    return (plugin.mcpServers || []).map((server) => {
      const normalized = normalizePluginMcpServer(server, plugin.id, packageSecret)
      ownedServerIds.add(normalized.id)
      return normalized
    })
  })
  const settingsStore = useSettingsStore.getState()
  // Keep user-managed servers that are not owned by an enabled package
  const nonPluginServers = (settingsStore.settings.mcpServers || []).filter(
    (server) => !ownedServerIds.has(server.id) && !plugins.some((p) => p.id === server.pluginId),
  )
  await settingsStore.update({
    mcpServers: [...nonPluginServers, ...pluginServers],
    ...(pluginServers.length ? { mcpEnabled: true } : {}),
  })
}

/** Replace absolute project paths in MCP args when user switches project. */
function rebindMcpArgsToRoot(
  args: string[] | undefined,
  newRoot: string,
  previousRoots: string[],
): string[] {
  if (!args?.length) return args || []
  const roots = previousRoots.filter(Boolean)
  return args.map((arg) => {
    if (arg === '${projectRoot}') return newRoot
    for (const old of roots) {
      if (arg === old) return newRoot
      // Windows path prefix replace
      if (old && arg.startsWith(old)) return newRoot + arg.slice(old.length)
    }
    return arg
  })
}

async function persistManifest(manifest: PluginManifest) {
  const api = pluginApi()
  if (api?.save) await api.save(manifest)
}

/** After authorize/refresh, restart MCP sessions that consume this secret so env reloads. */
async function stopMcpSessionsForSecretOwner(secretOwnerId: string) {
  const servers = useSettingsStore.getState().settings.mcpServers || []
  for (const s of servers) {
    if (s.secretPluginId === secretOwnerId || s.pluginId === secretOwnerId) {
      try {
        await window.subagents?.mcp?.stdioStop?.(s.id)
      } catch {
        /* ignore */
      }
    }
  }
}

async function loadFromDisk() {
  if (window.subagents?.hermes?.get) {
    const data = (await window.subagents.hermes.get()) as {
      memory?: MemoryBundle
      skills?: Array<{ path: string; raw: string }>
      soul?: string
      agents?: string
      plugins?: PluginManifest[]
    } | null
    if (data?.memory) memoryStore.loadBundle(data.memory)
    if (data?.skills) skillsStore.loadAll(data.skills)
    if (data?.soul) setSoulDoc(data.soul)
    if (data?.agents) setAgentsDoc(data.agents)
    if (data?.plugins) pluginRegistry.loadFromArray(data.plugins)
  } else {
    try {
      const raw = localStorage.getItem('subagents.hermes.v1')
      if (raw) {
        const data = JSON.parse(raw) as {
          memory?: MemoryBundle
          skills?: Array<{ path: string; raw: string }>
          soul?: string
          agents?: string
          plugins?: PluginManifest[]
        }
        if (data.memory) memoryStore.loadBundle(data.memory)
        if (data.skills) skillsStore.loadAll(data.skills)
        if (data.soul) setSoulDoc(data.soul)
        if (data.agents) setAgentsDoc(data.agents)
        if (data.plugins) pluginRegistry.loadFromArray(data.plugins)
      }
    } catch {
      /* ignore */
    }
  }
  // Also try Electron plugins dir
  if (window.subagents?.plugins?.list) {
    try {
      const files = (await window.subagents.plugins.list()) as PluginManifest[]
      if (files?.length) {
        pluginRegistry.loadFromArray([...pluginRegistry.list(), ...files])
      }
    } catch {
      /* ignore */
    }
  }
  pluginRegistry.apply()
  await syncPluginMcpServers()
}

async function saveToDisk() {
  const payload = {
    memory: memoryStore.getBundle(),
    skills: skillsStore.exportAll(),
    soul: getSoulDoc(),
    agents: getAgentsDoc(),
    plugins: pluginRegistry.exportAll(),
  }
  if (window.subagents?.hermes?.set) {
    await window.subagents.hermes.set(payload)
  } else {
    localStorage.setItem('subagents.hermes.v1', JSON.stringify(payload))
  }
}

function buildTokenRefreshDeps(getStore: () => LearningStore) {
  return {
    getClient: (clientKey: string) =>
      useSettingsStore.getState().settings.pluginOAuthClients?.[clientKey],
    refresh: async (input: {
      pluginId: string
      refreshToken: string
      clientId: string
      clientSecret?: string
      tokenUrl: string
      tokenAuth?: 'body' | 'basic'
    }) => {
      if (window.subagents?.oauth?.refresh) {
        return window.subagents.oauth.refresh(input)
      }
      try {
        const body = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: input.refreshToken,
          client_id: input.clientId,
        })
        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        }
        if (input.tokenAuth === 'basic') {
          if (!input.clientSecret) return { ok: false as const, error: '需要 Client Secret' }
          headers.Authorization = `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}`
        } else if (input.clientSecret) {
          body.set('client_secret', input.clientSecret)
        }
        const res = await fetch(input.tokenUrl, { method: 'POST', headers, body })
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!json.access_token) {
          return {
            ok: false as const,
            error: String(json.error_description || json.error || `HTTP ${res.status}`),
          }
        }
        return {
          ok: true as const,
          accessToken: String(json.access_token),
          refreshToken: json.refresh_token ? String(json.refresh_token) : input.refreshToken,
          expiresIn: json.expires_in ? Number(json.expires_in) : undefined,
          tokenType: json.token_type ? String(json.token_type) : undefined,
        }
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
      }
    },
    onRefreshed: async (
      pluginId: string,
      result: {
        accessToken?: string
        refreshToken?: string
        expiresIn?: number
        tokenType?: string
        /** Electron vault path: main already persisted; only metadata arrives */
        meta?: { tokenHint: string }
      },
    ) => {
      let tokenHint = result.meta?.tokenHint
      if (!result.meta && result.accessToken) {
        // Browser fallback: persist locally (raw token never reaches here on Electron)
        const meta = await setPluginSecret(pluginId, result.accessToken, {
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          tokenType: result.tokenType,
          keepRefreshToken: !result.refreshToken,
        })
        tokenHint = meta.tokenHint
      }
      // NOTE: no customToolSecrets mirroring — main resolves {{secret:*}} from the vault
      const existing = pluginRegistry.list().find((p) => p.id === pluginId)
      if (existing) {
        const next = {
          ...existing,
          connectorAuth: {
            mode: (existing.connectorAuth?.mode || 'oauth') as 'pat' | 'api_key' | 'oauth',
            hasCredential: true,
            accountHint: tokenHint || existing.connectorAuth?.accountHint,
            authorizedAt: new Date().toISOString(),
            lastAuthorizeUrl: existing.connectorAuth?.lastAuthorizeUrl,
          },
        }
        pluginRegistry.add(next)
        await persistManifest(next)
        await getStore().persist()
        getStore().refresh()
        await stopMcpSessionsForSecretOwner(pluginId)
        await getStore().checkPlugin(pluginId)
      }
    },
    onError: (pluginId: string, error: string) => {
      console.warn('[plugin-token-refresh]', pluginId, error)
    },
  }
}

export const useLearningStore = create<LearningStore>((set, get) => {
  let searchRequest = 0

  learningLoop.subscribe((events) => {
    set({
      events,
      pendingDrafts: learningLoop.getPendingSkillDrafts(),
      memory: memoryStore.getBundle(),
      skills: skillsStore.list(),
    })
    void get().persist()
  })

  return {
    loaded: false,
    memory: memoryStore.getBundle(),
    skills: skillsStore.list(),
    events: learningLoop.getEvents(),
    pendingDrafts: learningLoop.getPendingSkillDrafts(),
    soul: getSoulDoc(),
    agents: getAgentsDoc(),
    searchHits: [],
    searchSummary: null,
    plugins: pluginRegistry.list(),
    catalog: PLUGIN_CATALOG,
    installingPluginId: null,
    pluginHealth: {},
    pluginError: null,

    load: async () => {
      // P1-A: hydrate vault metadata mirror + one-time localStorage → vault migration
      try {
        const { hydratePluginSecrets } = await import('../agent/hermes/pluginSecrets')
        await hydratePluginSecrets()
      } catch {
        /* non-fatal */
      }
      await loadFromDisk()
      set({
        loaded: true,
        memory: memoryStore.getBundle(),
        skills: skillsStore.list(),
        events: learningLoop.getEvents(),
        pendingDrafts: learningLoop.getPendingSkillDrafts(),
        soul: getSoulDoc(),
        agents: getAgentsDoc(),
        plugins: pluginRegistry.list(),
      })
      await Promise.all(pluginRegistry.list().map((plugin) => get().checkPlugin(plugin.id)))
    },

    persist: async () => {
      await saveToDisk()
    },

    refresh: () => {
      set({
        memory: memoryStore.getBundle(),
        skills: skillsStore.list(),
        events: learningLoop.getEvents(),
        pendingDrafts: learningLoop.getPendingSkillDrafts(),
        soul: getSoulDoc(),
        agents: getAgentsDoc(),
        plugins: pluginRegistry.list(),
      })
    },

    setUserProfile: async (text) => {
      memoryStore.setUserProfile(text)
      get().refresh()
      await get().persist()
    },

    setMemoryDoc: async (text) => {
      memoryStore.setMemoryDoc(text)
      get().refresh()
      await get().persist()
    },

    appendMemory: async (text) => {
      memoryStore.appendMemory(text)
      get().refresh()
      await get().persist()
    },

    deleteMemoryEntry: async (id) => {
      memoryStore.deleteEntry(id)
      get().refresh()
      await get().persist()
    },

    clearMemories: async () => {
      memoryStore.clearAll()
      get().refresh()
      await get().persist()
    },

    setSoul: async (text) => {
      setSoulDoc(text)
      set({ soul: getSoulDoc() })
      await get().persist()
    },

    setAgents: async (text) => {
      setAgentsDoc(text)
      set({ agents: getAgentsDoc() })
      await get().persist()
    },

    approveDraft: async (name) => {
      learningLoop.approveSkillDraft(name)
      get().refresh()
      await get().persist()
    },

    rejectDraft: (name) => {
      learningLoop.rejectSkillDraft(name)
      get().refresh()
    },

    search: async (query, archive) => {
      const request = ++searchRequest
      const hits = searchSessions(query, archive)
      set({ searchHits: hits, searchSummary: null })
      const summary = await summarizeSessionHits(
        hits,
        query,
        useSettingsStore.getState().settings,
      )
      if (request === searchRequest) set({ searchSummary: summary })
    },

    saveSkill: async (name, description, body) => {
      skillsStore.save(
        {
          name,
          description,
          version: '1.0.0',
          author: 'user',
          createdBy: 'user',
        },
        body,
      )
      get().refresh()
      await get().persist()
    },

    restoreSkill: async (name) => {
      if (!skillsStore.restore(name)) return
      get().refresh()
      await get().persist()
    },

    removeSkill: async (name) => {
      skillsStore.remove(name)
      get().refresh()
      await get().persist()
    },

    setPluginEnabled: async (id, enabled) => {
      pluginRegistry.setEnabled(id, enabled)
      pluginRegistry.apply()
      get().refresh()
      await syncPluginMcpServers()
      const manifest = pluginRegistry.list().find((plugin) => plugin.id === id)
      if (manifest) await persistManifest(manifest)
      await get().persist()
      await get().checkPlugin(id)
    },

    importPlugin: async (manifest) => {
      const installed: PluginManifest = {
        ...manifest,
        enabled: manifest.enabled !== false,
        installedAt: manifest.installedAt || new Date().toISOString(),
        source: manifest.source || 'import',
        mcpServers: (manifest.mcpServers || []).map((server) =>
          normalizePluginMcpServer(
            server,
            manifest.id,
            (manifest as { secretPluginId?: string }).secretPluginId,
          ),
        ),
      }
      pluginRegistry.add(installed)
      pluginRegistry.apply()
      get().refresh()
      await syncPluginMcpServers()
      await persistManifest(installed)
      await get().persist()
      await get().checkPlugin(manifest.id)
    },

    removePlugin: async (id) => {
      set({ pluginError: null })
      const api = pluginApi()
      if (api?.uninstall) {
        const result = await api.uninstall(id)
        if (!result.ok) {
          const error = result.error || `無法移除外掛：${id}`
          set({ pluginError: error })
          return
        }
      } else if (api?.delete) {
        await api.delete(id)
      }
      await clearPluginSecret(id)
      pluginRegistry.remove(id)
      pluginRegistry.apply()
      get().refresh()
      await syncPluginMcpServers()
      await get().persist()
      set((state) => {
        const pluginHealth = { ...state.pluginHealth }
        delete pluginHealth[id]
        return { pluginHealth }
      })
    },

    installPlugin: async (id, projectRoot) => {
      const item = catalogItem(id)
      if (!item) {
        set({ pluginError: `找不到外掛目錄項目：${id}` })
        return
      }
      set({ installingPluginId: id, pluginError: null })
      try {
        const api = pluginApi()
        let manifest: PluginManifest | undefined
        let requiresSetup = item.installKind === 'connector'

        const stubManifest = (): PluginManifest => ({
          id: item.id,
          name: item.name,
          version: '1.0.0',
          enabled: false,
          description: item.description,
          source: `catalog:${item.installKind}`,
          // Attach catalog tools/skills so authorize → enable gives real FC surface
          ...(item.manifest || {}),
        })

        if (api?.install) {
          const result = await api.install({ id, ...(projectRoot ? { projectRoot } : {}) })
          manifest = result.manifest
          requiresSetup = result.requiresSetup === true || item.installKind === 'connector'
          if (!result.ok && !requiresSetup && !manifest) {
            throw new Error(result.error || `安裝外掛失敗：${item.name}`)
          }
          // Electron 回 setup-required 但沒有 manifest 時，仍登記到已安裝列供管理
          if (!manifest && requiresSetup) manifest = stubManifest()
        } else if (item.installKind === 'bundled' && item.manifest) {
          manifest = {
            id: item.id,
            name: item.name,
            enabled: true,
            ...item.manifest,
          }
        } else if (item.installKind === 'connector') {
          // 瀏覽器 / 無 installer：建立需設定 stub，讓 已安裝 strip 與「…」管理可用
          manifest = stubManifest()
          requiresSetup = true
        } else {
          throw new Error('此外掛需要 Electron 安裝服務')
        }

        if (manifest) {
          const installed: PluginManifest = {
            ...manifest,
            id: manifest.id || item.id,
            name: manifest.name || item.name,
            enabled: requiresSetup ? false : manifest.enabled !== false,
            installedAt: manifest.installedAt || new Date().toISOString(),
            source: manifest.source || `catalog:${item.installKind}`,
            mcpServers: (manifest.mcpServers || []).map((server) =>
              normalizePluginMcpServer(
                server,
                manifest.id || item.id,
                (manifest as { secretPluginId?: string }).secretPluginId ||
                  item.npm?.secretPluginId ||
                  item.dependsOnPluginId,
              ),
            ),
          }
          pluginRegistry.add(installed)
          pluginRegistry.apply()
          get().refresh()
          await syncPluginMcpServers()
          await persistManifest(installed)
          await get().persist()
        }

        if (requiresSetup) {
          const health: PluginHealth = { ok: false, status: 'setup-required' }
          set((state) => ({ pluginHealth: { ...state.pluginHealth, [id]: health } }))
        } else {
          await get().checkPlugin(id)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set((state) => ({
          pluginError: message,
          pluginHealth: {
            ...state.pluginHealth,
            [id]: { ok: false, status: 'error', error: message },
          },
        }))
      } finally {
        set({ installingPluginId: null })
      }
    },

    checkPlugin: async (id) => {
      let health: PluginHealth
      const api = pluginApi()
      if (api?.health) {
        try {
          const result = await api.health(id)
          if (result.status) {
            health = { ...result, status: result.status }
          } else if (!result.installed) {
            health = {
              ok: false,
              status: catalogItem(id)?.installKind === 'connector'
                ? 'setup-required'
                : 'not-installed',
              error: result.error,
            }
          } else {
            health = {
              ok: result.ok && result.healthy !== false,
              status: result.ok && result.healthy !== false ? 'ready' : 'error',
              toolCount: result.tools?.length,
              error: result.error,
            }
          }
        } catch (error) {
          health = {
            ok: false,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          }
        }
      } else {
        const installed = pluginRegistry.list().find((plugin) => plugin.id === id)
        const item = catalogItem(id)
        if (!installed) {
          health = {
            ok: false,
            status: item?.installKind === 'connector' ? 'setup-required' : 'not-installed',
          }
        } else if (item?.installKind === 'connector') {
          const ready =
            hasPluginSecret(id) || installed.connectorAuth?.hasCredential === true
          health = ready
            ? {
                ok: true,
                status: 'ready',
                error: installed.connectorAuth?.accountHint
                  ? `已授權 ${installed.connectorAuth.accountHint}`
                  : undefined,
              }
            : {
                ok: false,
                status: 'setup-required',
                error: item.setupHint,
              }
        } else if (item?.installKind === 'npm-mcp' || installed.mcpServers?.length) {
          const secretOwner =
            (installed as { secretPluginId?: string }).secretPluginId ||
            installed.mcpServers?.[0]?.secretPluginId ||
            item?.npm?.secretPluginId ||
            item?.dependsOnPluginId
          if (
            secretOwner &&
            !hasPluginSecret(secretOwner) &&
            !useSettingsStore.getState().settings.customToolSecrets?.[secretOwner]
          ) {
            health = {
              ok: false,
              status: 'setup-required',
              error: `需要先授權 ${secretOwner}（MCP 才能注入 token）`,
            }
          } else {
            health = {
              ok: installed.enabled,
              status: installed.enabled ? 'ready' : 'not-installed',
            }
          }
        } else {
          health = {
            ok: installed.enabled,
            status: installed.enabled ? 'ready' : 'not-installed',
          }
        }
      }
      set((state) => ({ pluginHealth: { ...state.pluginHealth, [id]: health } }))
      return health
    },

    authorizePlugin: async (id, token, extra) => {
      const item = catalogItem(id)
      const existing = pluginRegistry.list().find((plugin) => plugin.id === id)
      if (!existing) {
        set({ pluginError: `請先安裝外掛：${id}` })
        return
      }
      const trimmed = token.trim()
      if (!trimmed) {
        set({ pluginError: '請輸入有效的 token / API key' })
        return
      }
      const secretExtra = {
        refreshToken: extra?.refreshToken,
        expiresIn: extra?.expiresIn,
        tokenType: extra?.tokenType,
        keepRefreshToken: extra?.refreshToken === undefined,
      }
      try {
        await setPluginSecret(id, trimmed, secretExtra)
      } catch (e) {
        // Issue 06 — 無 OS 鑰匙圈：預設拒絕明文落地，明確確認後才重試
        const err = e as Error & { code?: string }
        const confirmFn = (globalThis as { confirm?: (msg: string) => boolean }).confirm
        if (
          err.code === 'PLAINTEXT_REQUIRED' &&
          confirmFn?.(
            '此裝置沒有可用的 OS 安全儲存（keychain / DPAPI），憑證將以「未加密明文」存在本機檔案。確定要繼續儲存嗎？',
          )
        ) {
          await setPluginSecret(id, trimmed, { ...secretExtra, allowPlaintext: true })
        } else {
          set({ pluginError: `憑證未儲存：${err.message}` })
          return
        }
      }
      // NOTE: no customToolSecrets mirror — {{secret:pluginId}} resolves from the
      // vault in main (http/mcp); browser fallback reads the local record directly.
      const mode: 'pat' | 'api_key' | 'oauth' =
        item?.auth?.type === 'oauth' || oauthProviderForPlugin(id)
          ? 'oauth'
          : item?.auth?.type === 'api_key'
            ? 'api_key'
            : 'pat'
      // Ensure catalog tools are present even if installed before tools existed
      const catalogTools = item?.manifest?.customTools
      const next: typeof existing = {
        ...existing,
        enabled: true,
        customTools: existing.customTools?.length
          ? existing.customTools
          : catalogTools || existing.customTools,
        promptAppend: existing.promptAppend || item?.manifest?.promptAppend,
        skills: existing.skills?.length ? existing.skills : item?.manifest?.skills,
        connectorAuth: {
          mode,
          hasCredential: true,
          accountHint: accountHintFromToken(trimmed),
          authorizedAt: new Date().toISOString(),
          lastAuthorizeUrl: item?.auth?.authorizeUrl || item?.auth?.docsUrl,
        },
      }
      pluginRegistry.add(next)
      pluginRegistry.apply()
      get().refresh()
      await persistManifest(next)
      await get().persist()
      await stopMcpSessionsForSecretOwner(id)
      await get().checkPlugin(id)
      // Also refresh health of npm-mcp packages that depend on this secret
      for (const p of pluginRegistry.list()) {
        const item = catalogItem(p.id)
        if (item?.npm?.secretPluginId === id || item?.dependsOnPluginId === id) {
          await get().checkPlugin(p.id)
        }
      }
      set({ pluginError: null })
    },

    runPluginOAuth: async (id, client) => {
      const item = catalogItem(id)
      const provider = oauthProviderForPlugin(id)
      if (!provider) {
        const msg = `外掛 ${id} 不支援 OAuth 流程`
        set({ pluginError: msg })
        return { ok: false, error: msg }
      }
      if (!pluginRegistry.list().some((p) => p.id === id)) {
        const msg = `請先安裝外掛：${item?.name || id}`
        set({ pluginError: msg })
        return { ok: false, error: msg }
      }
      const clientId = client.clientId.trim()
      if (!clientId) {
        const msg = '請填寫 OAuth Client ID'
        set({ pluginError: msg })
        return { ok: false, error: msg }
      }
      // Persist client credentials for next time
      const settings = useSettingsStore.getState()
      const prev = settings.settings.pluginOAuthClients || {}
      await settings.update({
        pluginOAuthClients: {
          ...prev,
          [provider.clientKey]: {
            clientId,
            clientSecret: client.clientSecret?.trim() || prev[provider.clientKey]?.clientSecret,
          },
        },
      })

      const api = window.subagents?.oauth
      if (!api?.run) {
        const msg = 'OAuth 需要 Electron 桌面版（npm run dev 開出桌面視窗）'
        set({ pluginError: msg })
        return { ok: false, error: msg }
      }
      set({ pluginError: null })
      try {
        const result = await api.run({
          pluginId: id,
          clientId,
          clientSecret: client.clientSecret?.trim() || undefined,
        })
        if (!result.ok || !result.accessToken) {
          const error = result.error || 'OAuth 失敗'
          set({ pluginError: error })
          return { ok: false, error }
        }
        await get().authorizePlugin(id, result.accessToken, {
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          tokenType: result.tokenType,
        })
        return { ok: true }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        set({ pluginError: message })
        return { ok: false, error: message }
      }
    },

    approveToolPackage: async (pluginId) => {
      const plugin = pluginRegistry.list().find((p) => p.id === pluginId)
      if (!plugin?.toolPackage) return { ok: false, message: `外掛 ${pluginId} 沒有 tool package` }
      const { validateToolPackage, packageFingerprint, runToolPackageHealth } = await import(
        '../agent/tools/toolPackage'
      )
      const v = validateToolPackage(plugin.toolPackage)
      if (!v.ok || !v.manifest) {
        return { ok: false, message: `manifest 驗證失敗：${v.errors.join('；')}` }
      }
      // Production health caller — surface failures but still allow approve
      let healthNote = ''
      try {
        const health = await runToolPackageHealth(v.manifest)
        if (health.length) {
          const bad = health.filter((h) => !h.ok)
          healthNote = bad.length
            ? ` · 健康檢查 ${bad.length}/${health.length} 失敗：${bad.map((h) => h.tool).join(', ')}`
            : ` · 健康檢查 ${health.length} 項通過`
        }
      } catch (e) {
        healthNote = ` · 健康檢查略過：${e instanceof Error ? e.message : String(e)}`
      }
      const next = {
        ...plugin,
        packageReview: {
          approvedFingerprint: packageFingerprint(v.manifest),
          approvedAt: new Date().toISOString(),
          approvedVersion: v.manifest.version,
        },
      }
      pluginRegistry.add(next)
      pluginRegistry.apply()
      await persistManifest(next)
      await get().persist()
      get().refresh()
      return {
        ok: true,
        message: `已核准 ${v.manifest.id}@${v.manifest.version} 的權限面（write/destructive 工具已解鎖，執行仍逐次審批）${healthNote}`,
      }
    },

    refreshPluginTokens: async () => refreshDueTokens(buildTokenRefreshDeps(() => get())),

    startTokenRefreshScheduler: () => {
      startPluginTokenRefreshScheduler({
        ...buildTokenRefreshDeps(() => get()),
        intervalMs: 60_000,
      })
    },

    stopTokenRefreshScheduler: () => {
      stopPluginTokenRefreshScheduler()
    },

    rebindPluginProjectRoots: async (projectRoot) => {
      const root = projectRoot.trim()
      if (!root) return
      const previous = new Set<string>()
      for (const plugin of pluginRegistry.list()) {
        for (const server of plugin.mcpServers || []) {
          for (const a of server.args || []) {
            if (a && a !== '${projectRoot}' && !a.startsWith('-') && /[/\\]/.test(a)) {
              previous.add(a)
            }
          }
        }
      }
      const prevList = [...previous]
      let anyChanged = false
      for (const plugin of pluginRegistry.list()) {
        if (!plugin.mcpServers?.length) continue
        const item = catalogItem(plugin.id)
        if (item?.npm && !item.npm.requiresProjectRoot) continue
        let pluginChanged = false
        const nextServers = plugin.mcpServers.map((server) => {
          const nextArgs = rebindMcpArgsToRoot(server.args, root, prevList)
          if (JSON.stringify(nextArgs) !== JSON.stringify(server.args || [])) pluginChanged = true
          return { ...server, args: nextArgs }
        })
        if (pluginChanged) {
          anyChanged = true
          const next = { ...plugin, mcpServers: nextServers }
          pluginRegistry.add(next)
          await persistManifest(next)
        }
      }
      if (anyChanged) {
        pluginRegistry.apply()
        get().refresh()
        await syncPluginMcpServers()
        await get().persist()
        // Restart stdio sessions so new args take effect
        try {
          await window.subagents?.mcp?.stdioStopAll?.()
        } catch {
          /* ignore */
        }
      }
    },

    clearPluginAuth: async (id) => {
      clearPluginSecret(id)
      const settingsStore = useSettingsStore.getState()
      const secrets = { ...(settingsStore.settings.customToolSecrets || {}) }
      delete secrets[id]
      await settingsStore.update({ customToolSecrets: secrets })
      const existing = pluginRegistry.list().find((plugin) => plugin.id === id)
      if (existing) {
        const next = {
          ...existing,
          enabled: false,
          connectorAuth: {
            mode: existing.connectorAuth?.mode || 'pat',
            hasCredential: false,
            accountHint: undefined,
            authorizedAt: undefined,
            lastAuthorizeUrl: existing.connectorAuth?.lastAuthorizeUrl,
          },
        }
        pluginRegistry.add(next)
        pluginRegistry.apply()
        get().refresh()
        await persistManifest(next)
        await get().persist()
      }
      await get().checkPlugin(id)
    },

    applyPlugins: () => {
      pluginRegistry.apply()
      get().refresh()
      void syncPluginMcpServers()
    },
  }
})
