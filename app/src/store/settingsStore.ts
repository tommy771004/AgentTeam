import { create } from 'zustand'
import { DEFAULT_LLM_SETTINGS } from '../agent/llm'
import { mergeCliProviders } from '../agent/cliProviders'
import { recommendToolTuning } from '../agent/modelTuning'
import type { LlmSettings } from '../agent/types'

const STORAGE_KEY = 'subagents.settings.v1'

function mergeSettings(...parts: Array<Partial<LlmSettings> | null | undefined>): LlmSettings {
  let out: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    roleModels: { ...DEFAULT_LLM_SETTINGS.roleModels },
    discoveredModels: [...DEFAULT_LLM_SETTINGS.discoveredModels],
    fallbackModels: [...DEFAULT_LLM_SETTINGS.fallbackModels],
    mcpServers: [...(DEFAULT_LLM_SETTINGS.mcpServers || [])],
    mcpAgentServers: { ...(DEFAULT_LLM_SETTINGS.mcpAgentServers || {}) },
    customTools: [...(DEFAULT_LLM_SETTINGS.customTools || [])],
    customToolSecrets: { ...(DEFAULT_LLM_SETTINGS.customToolSecrets || {}) },
    pluginOAuthClients: { ...(DEFAULT_LLM_SETTINGS.pluginOAuthClients || {}) },
    cliProviders: mergeCliProviders(DEFAULT_LLM_SETTINGS.cliProviders),
  }
  for (const p of parts) {
    if (!p) continue
    out = {
      ...out,
      ...p,
      roleModels: {
        ...out.roleModels,
        ...(p.roleModels || {}),
      },
      mcpServers: p.mcpServers != null ? p.mcpServers : out.mcpServers,
      mcpAgentServers:
        p.mcpAgentServers != null
          ? Object.fromEntries(
              Object.entries(p.mcpAgentServers).map(([agent, ids]) => [
                agent,
                [...new Set((ids || []).filter(Boolean))],
              ]),
            )
          : out.mcpAgentServers,
      discoveredModels:
        p.discoveredModels != null ? [...new Set(p.discoveredModels.filter(Boolean))] : out.discoveredModels,
      fallbackModels:
        p.fallbackModels != null ? [...new Set(p.fallbackModels.filter(Boolean))] : out.fallbackModels,
      customTools: p.customTools != null ? p.customTools : out.customTools,
      customToolSecrets:
        p.customToolSecrets != null ? { ...out.customToolSecrets, ...p.customToolSecrets } : out.customToolSecrets,
      pluginOAuthClients:
        p.pluginOAuthClients != null
          ? { ...out.pluginOAuthClients, ...p.pluginOAuthClients }
          : out.pluginOAuthClients,
      cliProviders:
        p.cliProviders != null ? mergeCliProviders(p.cliProviders) : out.cliProviders,
      alwaysOnCapabilities:
        p.alwaysOnCapabilities != null
          ? [...p.alwaysOnCapabilities]
          : out.alwaysOnCapabilities,
      modelProfiles:
        p.modelProfiles != null
          ? { ...out.modelProfiles, ...p.modelProfiles }
          : out.modelProfiles,
      hookRules: p.hookRules != null ? [...p.hookRules] : out.hookRules,
    }
  }
  return out
}

function loadLocal(): LlmSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return mergeSettings()
    return mergeSettings(JSON.parse(raw))
  } catch {
    return mergeSettings()
  }
}

function saveLocal(s: LlmSettings) {
  // Electron persists custom-tool secrets through safeStorage in the main process;
  // don't duplicate those values in renderer localStorage.
  const local = window.subagents?.settings ? { ...s, customToolSecrets: {} } : s
  localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
}

interface SettingsStore {
  settings: LlmSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<LlmSettings>) => Promise<void>
  testConnection: (model?: string) => Promise<{ ok: boolean; message: string }>
  exportBundle: () => Promise<string>
  importBundle: (json: string) => Promise<{ ok: boolean; message: string }>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadLocal(),
  loaded: false,

  load: async () => {
    if (window.subagents?.settings?.get) {
      try {
        const remote = (await window.subagents.settings.get()) as Partial<LlmSettings> | null
        if (remote) {
          const merged = mergeSettings(loadLocal(), remote)
          set({ settings: merged, loaded: true })
          saveLocal(merged)
          return
        }
      } catch {
        /* fall through */
      }
    }
    set({ settings: loadLocal(), loaded: true })
  },

  update: async (patch) => {
    let next = mergeSettings(get().settings, patch)
    // Soft-auto: when model changes and tool budgets still match defaults, apply tuning
    if (patch.model != null && patch.model !== get().settings.model) {
      const prev = get().settings
      const atDefaults =
        prev.toolSearchThreshold === DEFAULT_LLM_SETTINGS.toolSearchThreshold &&
        prev.maxToolPayloadKb === DEFAULT_LLM_SETTINGS.maxToolPayloadKb &&
        prev.maxToolRounds === DEFAULT_LLM_SETTINGS.maxToolRounds
      const notOverridden =
        patch.toolSearchThreshold == null &&
        patch.maxToolPayloadKb == null &&
        patch.maxToolRounds == null
      if (atDefaults && notOverridden && String(patch.model).trim()) {
        const rec = recommendToolTuning(String(patch.model))
        next = mergeSettings(next, {
          toolSearchThreshold: rec.toolSearchThreshold,
          maxToolPayloadKb: rec.maxToolPayloadKb,
          maxToolRounds: rec.maxToolRounds,
        })
      }
    }
    set({ settings: next })
    saveLocal(next)
    // Live-apply into running engine (personality / memory toggles / safety…)
    try {
      const { agentEngine } = await import('../agent/engine')
      agentEngine.configure(next)
    } catch {
      /* ignore if engine unavailable */
    }
    if (window.subagents?.settings?.set) {
      await window.subagents.settings.set(next)
    }
  },

  testConnection: async (model) => {
    const s = get().settings
    if (!s.apiKey) return { ok: false, message: 'API key is empty' }
    const m = model || s.model
    try {
      let discoveredModels: string[] = []
      if (window.subagents?.llm?.models) {
        try {
          const listed = await window.subagents.llm.models({ baseUrl: s.baseUrl, apiKey: s.apiKey })
          discoveredModels = listed.models
          if (discoveredModels.length) await get().update({ discoveredModels })
        } catch {
          // Some compatible gateways omit /models; a chat probe remains valid.
        }
      }
      if (window.subagents?.llm?.chat) {
        const r = await window.subagents.llm.chat({
          baseUrl: s.baseUrl,
          apiKey: s.apiKey,
          fallbackModels: s.fallbackModels,
          model: m,
          messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
          max_tokens: 8,
          temperature: 0,
        })
        const fallbackNote = r.model && r.model !== m ? ` · 已自動切換備援 ${r.model}` : ''
        return { ok: true, message: `OK · ${r.model} · ${discoveredModels.length} models${fallbackNote} · "${r.content.slice(0, 40)}"` }
      }
      const base = s.baseUrl.replace(/\/$/, '')
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${s.apiKey}` },
      })
      if (!res.ok) return { ok: false, message: `HTTP ${res.status}` }
      const body = (await res.json()) as { data?: Array<{ id?: string }> }
      discoveredModels = (body.data || []).map((x) => x.id || '').filter(Boolean)
      if (discoveredModels.length) await get().update({ discoveredModels })
      return { ok: true, message: `找到 ${discoveredModels.length} 個模型（target: ${m}）` }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/aihubmix\.com/i.test(s.baseUrl) && message.includes('no_available_channel')) {
        const tid = message.match(/tid:\s*([\w-]+)/i)?.[1]
        const fallbacks = s.fallbackModels.length
          ? s.fallbackModels.join('、')
          : 'gpt-4.1-mini-free、glm-4.7-flash-free'
        return {
          ok: false,
          message: `AIHubMix 暫時無法路由「${m}」。已嘗試備援模型；請稍後重試或改選：${fallbacks}${tid ? `（tid: ${tid}）` : ''}`,
        }
      }
      return { ok: false, message }
    }
  },

  exportBundle: async () => {
    const settings = get().settings
    let jobs: unknown[] = []
    let events: unknown[] = []
    if (window.subagents?.scheduler?.list) {
      jobs = await window.subagents.scheduler.list()
    } else {
      try {
        jobs = JSON.parse(localStorage.getItem('subagents.jobs') || '[]')
      } catch {
        jobs = []
      }
    }
    if (window.subagents?.events?.list) {
      events = await window.subagents.events.list()
    } else {
      try {
        events = JSON.parse(localStorage.getItem('subagents.events') || '[]')
      } catch {
        events = []
      }
    }

    // Hermes learning assets (skills / memory / soul) — durable learning must export
    let hermes: unknown = null
    try {
      if (window.subagents?.hermes?.get) {
        hermes = await window.subagents.hermes.get()
      } else {
        const raw = localStorage.getItem('subagents.hermes.v1')
        hermes = raw ? JSON.parse(raw) : null
      }
    } catch {
      hermes = null
    }

    // Never write secrets in cleartext — restore can re-enter keys
    const redactedSettings: LlmSettings = {
      ...settings,
      apiKey: settings.apiKey ? '***REDACTED***' : '',
      telegramBotToken: settings.telegramBotToken ? '***REDACTED***' : '',
      webhookToken: settings.webhookToken ? '***REDACTED***' : '',
      customToolSecrets: Object.fromEntries(
        Object.keys(settings.customToolSecrets || {}).map((key) => [key, '***REDACTED***']),
      ),
      pluginOAuthClients: Object.fromEntries(
        Object.entries(settings.pluginOAuthClients || {}).map(([key, value]) => [
          key,
          {
            clientId: value.clientId,
            clientSecret: value.clientSecret ? '***REDACTED***' : undefined,
          },
        ]),
      ),
      cliProviders: (settings.cliProviders || []).map((p) => ({
        ...p,
        apiKey: p.apiKey ? '***REDACTED***' : p.apiKey,
      })),
    }

    return JSON.stringify(
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        settings: redactedSettings,
        jobs,
        events,
        hermes,
        note: 'Secrets redacted (apiKey / tokens). Re-enter after import. Includes hermes skills/memory when present.',
      },
      null,
      2,
    )
  },

  importBundle: async (json) => {
    try {
      const data = JSON.parse(json) as {
        settings?: Partial<LlmSettings>
        jobs?: unknown[]
        events?: unknown[]
        hermes?: unknown
      }
      if (data.settings) {
        // Skip redacted secrets so we do not wipe live keys
        const patch = { ...data.settings } as Partial<LlmSettings>
        if (patch.apiKey === '***REDACTED***') delete patch.apiKey
        if (patch.telegramBotToken === '***REDACTED***') delete patch.telegramBotToken
        if (patch.webhookToken === '***REDACTED***') delete patch.webhookToken
        if (patch.customToolSecrets) {
          const live = get().settings.customToolSecrets || {}
          patch.customToolSecrets = Object.fromEntries(
            Object.entries(patch.customToolSecrets).map(([key, value]) => [
              key,
              value === '***REDACTED***' ? live[key] || '' : value,
            ]),
          )
        }
        if (patch.pluginOAuthClients) {
          const live = get().settings.pluginOAuthClients || {}
          patch.pluginOAuthClients = Object.fromEntries(
            Object.entries(patch.pluginOAuthClients).map(([key, value]) => [
              key,
              {
                clientId: value.clientId,
                clientSecret:
                  value.clientSecret === '***REDACTED***'
                    ? live[key]?.clientSecret
                    : value.clientSecret,
              },
            ]),
          )
        }
        if (patch.cliProviders) {
          const live = get().settings.cliProviders || []
          patch.cliProviders = patch.cliProviders.map((p, i) => {
            if (p.apiKey === '***REDACTED***') {
              const prev = live.find((x) => x.id === p.id) || live[i]
              return { ...p, apiKey: prev?.apiKey || '' }
            }
            return p
          })
        }
        await get().update(patch)
      }
      if (data.jobs && window.subagents?.scheduler?.saveAll) {
        await window.subagents.scheduler.saveAll(data.jobs)
      } else if (data.jobs) {
        localStorage.setItem('subagents.jobs', JSON.stringify(data.jobs))
      }
      if (data.events && window.subagents?.events?.saveAll) {
        await window.subagents.events.saveAll(data.events)
      } else if (data.events) {
        localStorage.setItem('subagents.events', JSON.stringify(data.events))
      }
      if (data.hermes) {
        if (window.subagents?.hermes?.set) {
          await window.subagents.hermes.set(data.hermes)
        } else {
          localStorage.setItem('subagents.hermes.v1', JSON.stringify(data.hermes))
        }
      }
      return {
        ok: true,
        message:
          'Bundle imported（secrets 若為 REDACTED 則保留本機金鑰）。請重新整理 Scheduler/Events/學習中心。',
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  },
}))
