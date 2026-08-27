import { create } from 'zustand'
import { DEFAULT_LLM_SETTINGS } from '../agent/llm.ts'
import { mergeCliProviders } from '../agent/cliProviders.ts'
import { recommendToolTuning } from '../agent/modelTuning.ts'
import { redactSettingsForExport, withoutLegacyHermesMemory, preserveLegacyHermesMemory } from '../agent/settingsExport.ts'
import {
  isElectronPiProduction,
  piSettingsPatchFromLlmSettings,
  stripPiOwnedSettings,
} from '../agent/piProduction.ts'
import {
  SETTINGS_CUSTOM_MERGE_KEYS,
  type SettingsCustomMergeKey,
} from '../agent/settingsMergeKeys.ts'
import type { LlmSettings } from '../agent/types.ts'
import { isSubscriptionProviderPreset } from '../agent/apiProviders.ts'

export { SETTINGS_CUSTOM_MERGE_KEYS, type SettingsCustomMergeKey }

const STORAGE_KEY = 'subagents.settings.v1'

async function readCanonicalMemoryExport(): Promise<unknown> {
  const exportBundle = window.subagents?.piHost?.memoryProjection?.exportBundle
  if (!exportBundle) {
    throw new Error('目前執行環境不支援 Host canonical memory export；未產生不完整備份。')
  }
  return exportBundle()
}

async function importNonMemoryHermes(incoming: unknown): Promise<void> {
  const bridge = window.subagents?.hermes
  if (bridge?.set) {
    if (typeof bridge.get !== 'function') throw new Error('無法讀取既有 Hermes 資料，未套用匯入。')
    const current = await bridge.get()
    await bridge.set(preserveLegacyHermesMemory(current, incoming))
    return
  }
  const current = JSON.parse(localStorage.getItem('subagents.hermes.v1') || 'null')
  localStorage.setItem('subagents.hermes.v1', JSON.stringify(preserveLegacyHermesMemory(current, incoming)))
}

/**
 * Deep-merge settings patches. Fields in SETTINGS_CUSTOM_MERGE_KEYS must have
 * explicit handling below — the completeness smoke fails if a new object/array
 * default is added without a matching key + branch.
 */
export function mergeSettings(...parts: Array<Partial<LlmSettings> | null | undefined>): LlmSettings {
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
    alwaysOnCapabilities: [...(DEFAULT_LLM_SETTINGS.alwaysOnCapabilities || [])],
    modelProfiles: { ...(DEFAULT_LLM_SETTINGS.modelProfiles || {}) },
    hookRules: [...(DEFAULT_LLM_SETTINGS.hookRules || [])],
    trustedHookProjects: [...(DEFAULT_LLM_SETTINGS.trustedHookProjects || [])],
    delegatePersonas: { ...(DEFAULT_LLM_SETTINGS.delegatePersonas || {}) },
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
      trustedHookProjects:
        p.trustedHookProjects != null
          ? [...new Set(p.trustedHookProjects.filter(Boolean))]
          : out.trustedHookProjects,
      delegatePersonas:
        p.delegatePersonas != null
          ? { ...out.delegatePersonas, ...p.delegatePersonas }
          : out.delegatePersonas,
    }
  }
  // Migration: cross-thread execution is now an invariant, not an opt-in.
  // Keep the persisted field for bundle compatibility, but never restore the
  // legacy app-wide single-run lock.
  out.concurrentRunsEnabled = true
  return out
}

function loadLocal(): LlmSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return mergeSettings()
    const parsed = JSON.parse(raw) as Partial<LlmSettings>
    return mergeSettings(isElectronPiProduction() ? stripPiOwnedSettings(parsed) : parsed)
  } catch {
    return mergeSettings()
  }
}

function saveLocal(s: LlmSettings) {
  // Electron persists custom-tool secrets through safeStorage in the main process;
  // don't duplicate those values in renderer localStorage.
  const source = isElectronPiProduction() ? stripPiOwnedSettings(s) : s
  const local = window.subagents?.settings ? { ...source, customToolSecrets: {} } : source
  localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
}

interface SettingsStore {
  settings: LlmSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<LlmSettings>) => Promise<void>
  /** Refresh the renderer projection after Pi Host-owned settings change. */
  syncPiHostSettings: (settings: {
    model: string
    approvalMode: LlmSettings['approvalMode']
    unattended: boolean
    workspaceTextSearch?: boolean
  }) => void
  testConnection: (model?: string) => Promise<{ ok: boolean; message: string }>
  exportBundle: () => Promise<string>
  importBundle: (json: string) => Promise<{ ok: boolean; message: string }>
}

function missingCredentialMessage(settings: LlmSettings): string {
  return isSubscriptionProviderPreset(settings.apiProvider)
    ? '訂閱連線由 Pi Core Host 提供；此環境沒有 Host。'
    : 'API key is empty'
}

function shouldRejectBrowserProbe(settings: LlmSettings): boolean {
  return isSubscriptionProviderPreset(settings.apiProvider) || !settings.apiKey
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadLocal(),
  loaded: false,

  syncPiHostSettings: (pi) => {
    const next = mergeSettings(get().settings, {
      model: pi.model,
      approvalMode: pi.approvalMode,
      unattended: pi.unattended,
      workspaceTextSearch: pi.workspaceTextSearch === true,
    })
    set({ settings: next })
    saveLocal(next)
  },

  load: async () => {
    let base: LlmSettings
    if (window.subagents?.settings?.get) {
      try {
        const remote = (await window.subagents.settings.get()) as Partial<LlmSettings> | null
        if (remote) {
          base = mergeSettings(loadLocal(), isElectronPiProduction() ? stripPiOwnedSettings(remote) : remote)
        } else {
          base = loadLocal()
        }
      } catch {
        base = loadLocal()
      }
    } else {
      base = loadLocal()
    }

    // Electron Pi Host owns the overlapping runtime profile. The legacy
    // settings bridge remains only for provider credentials, CLI, and UI-only
    // preferences; model/approval/unattended/workspaceTextSearch are projected from Pi here.
    if (window.subagents?.piHost?.settings?.get) {
      try {
        const pi = await window.subagents.piHost.settings.get()
        if (pi?.settings) {
          base = mergeSettings(base, {
            model: pi.settings.model,
            approvalMode: pi.settings.approvalMode,
            unattended: pi.settings.unattended,
            workspaceTextSearch: pi.settings.workspaceTextSearch === true,
          })
        }
      } catch {
        /* Pi Host startup/recovery will retry on the next bootstrap. */
      }
    }

    // Ticket 16: deploy posture is main-owned. Hydrate outboundGuardDeploy from
    // outbound:status so runtime effective mode matches host SUBAGENTS_OUTBOUND_GUARD
    // even when the renderer process.env is empty.
    try {
      const statusFn = window.subagents?.outbound?.status
      if (typeof statusFn === 'function') {
        const status = await statusFn({
          apiProvider: base.apiProvider,
          baseUrl: base.baseUrl,
        })
        if (status && 'deployGuard' in status) {
          const { applyMainOutboundStatusToSettings } = await import(
            '../agent/outbound/outboundGate.ts'
          )
          const applied = applyMainOutboundStatusToSettings(base, {
            deployGuard: status.deployGuard as
              | 'off'
              | 'demo'
              | 'optional'
              | 'required'
              | 'invalid',
          })
          if (applied.ok) {
            const prevDeploy = base.outboundGuardDeploy || 'off'
            base = mergeSettings(base, applied.patch)
            // Ticket 04 residual: mode transition evidence (metadata only, main ledger)
            if (
              applied.patch.outboundGuardDeploy &&
              applied.patch.outboundGuardDeploy !== prevDeploy
            ) {
              try {
                const { buildGuardModeChangeEvidence } = await import(
                  '../agent/outbound/evidenceLedger.ts'
                )
                const ev = buildGuardModeChangeEvidence({
                  fromMode: prevDeploy,
                  toMode: applied.patch.outboundGuardDeploy,
                })
                // Non-privileged type — may go via IPC; main also owns privileged path.
                void window.subagents?.outbound?.appendEvidence?.(ev as never, false)
              } catch {
                /* non-fatal */
              }
            }
          }
        }
      }
    } catch {
      /* browser / missing bridge — keep env/settings fallback */
    }

    set({ settings: base, loaded: true })
    saveLocal(base)
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
    // Pi Host is the only runtime owner (ADR-0045/ADR-0046). Nothing in the
    // renderer executes settings any more; the bridge only persists them.
    if (!isElectronPiProduction()) {
      if (window.subagents?.settings?.set) await window.subagents.settings.set(next)
    } else if (window.subagents?.settings?.set) {
      // Pi Host owns runtime settings, but the legacy bridge still persists
      // renderer-owned preferences (theme, layout, notifications, integrations,
      // and other UI settings). Keep it in sync so a later load/remount cannot
      // overwrite a newer local value with a stale disk snapshot.
      await window.subagents.settings.set(stripPiOwnedSettings(next))
    }
    if (window.subagents?.piHost?.settings?.update) {
      const connectionChanged = ['apiProvider', 'baseUrl', 'apiKey', 'model']
        .some((key) => Object.prototype.hasOwnProperty.call(patch, key))
      // Subscription stripping lives in piSettingsPatchFromLlmSettings
      // (ADR-0052) — the single owner for what may reach the Host.
      const piPatch = piSettingsPatchFromLlmSettings(connectionChanged
        ? {
            ...patch,
            apiProvider: next.apiProvider,
            baseUrl: next.baseUrl,
            model: next.model,
          }
        : patch)
      if (Object.keys(piPatch).length) await window.subagents.piHost.settings.update(piPatch)
    }
  },

  testConnection: async (model) => {
    const s = get().settings
    if (isElectronPiProduction()) {
      try {
        const health = await window.subagents?.piHost?.health?.()
        return health?.status === 'ready'
          ? { ok: true, message: `Pi Core Host ready · ${s.model || 'model from host'}` }
          : { ok: false, message: 'Pi Core Host is not ready' }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
    // ADR-0052: a subscription connection has no OpenAI-compatible endpoint or
    // key to probe; its health is the Host's, already returned above in
    // Electron production. This check must precede the key check — subscription
    // connections never carry an apiKey, so "API key is empty" would be a lie.
    if (shouldRejectBrowserProbe(s)) {
      return {
        ok: false,
        message: missingCredentialMessage(s),
      }
    }
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

    // Legacy Hermes may still carry skills/soul for browser compatibility, but
    // its renderer memory is never a backup authority.
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
    hermes = withoutLegacyHermesMemory(hermes)
    const canonicalMemory = await readCanonicalMemoryExport()

    // Issue 06 — pattern-based 遮罩（settingsExport.ts）：新增祕密欄位不會漏
    const { settings: redactedSettings, redactedFields } = redactSettingsForExport(
      settings as unknown as Record<string, unknown>,
    )

    return JSON.stringify(
      {
        version: 3,
        exportedAt: new Date().toISOString(),
        settings: redactedSettings as unknown as LlmSettings,
        jobs,
        events,
        hermes,
        canonicalMemory,
        canonicalMemoryStatus: 'included',
        redactedFields,
        note: 'Secrets redacted (apiKey / tokens). Re-enter after import. Canonical memory is plaintext user data and is not encrypted.',
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
      if (data.hermes) await importNonMemoryHermes(data.hermes)
      return {
        ok: true,
        message:
          '設定已匯入（REDACTED 保留本機金鑰）；未套用任何記憶。記憶請使用獨立的預覽匯入。',
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  },
}))
