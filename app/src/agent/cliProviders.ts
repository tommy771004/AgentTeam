/**
 * CLI provider shells — NO hardcoded model catalogs.
 * Models/depths come only from local discovery or user settings.
 */

import type { ThinkingDepth } from './thinking.ts'

export type CliKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'cursor'
  | 'codex'
  | 'grok'
  | 'custom'

export interface CliModelOption {
  id: string
  label: string
  /** 此模型建議的推理深度；空 = 使用全部 THINKING_DEPTHS */
  depths?: ThinkingDepth[]
}

export type ProviderServiceTier = 'provider-default' | 'standard' | 'priority' | 'flex'

export interface CliProviderConfig {
  id: string
  kind: CliKind
  name: string
  enabled: boolean
  authorized: boolean
  apiKey?: string
  baseUrl?: string
  /** CLI 二進位名稱或絕對路徑（可空白 = 由偵測填入） */
  cliBinary?: string
  /** Provider latency/billing tier; independent from orchestration speed. */
  serviceTier?: ProviderServiceTier
  /** Last read-only local probe; never includes credentials. */
  lastProbeAt?: string
  diagnostic?: {
    foundBinary: boolean
    binaryPath: string | null
    authNote: string
    capabilities?: import('./cliProviderCapabilities.ts').CliProviderCapabilitySnapshot
  }
  models: CliModelOption[]
}

/** Structural templates only — models always start empty */
export const DEFAULT_CLI_PROVIDERS: CliProviderConfig[] = [
  {
    id: 'openai',
    kind: 'openai',
    name: 'OpenAI',
    enabled: false,
    authorized: false,
    baseUrl: '',
    models: [],
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    name: 'Anthropic / Claude',
    enabled: false,
    authorized: false,
    baseUrl: '',
    cliBinary: 'claude',
    models: [],
  },
  {
    id: 'google',
    kind: 'google',
    name: 'Google / Gemini',
    enabled: false,
    authorized: false,
    baseUrl: '',
    cliBinary: 'gemini',
    models: [],
  },
  {
    id: 'cursor',
    kind: 'cursor',
    name: 'Cursor CLI',
    enabled: false,
    authorized: false,
    cliBinary: 'cursor-agent',
    models: [],
  },
  {
    id: 'codex',
    kind: 'codex',
    name: 'Codex CLI',
    enabled: false,
    authorized: false,
    cliBinary: 'codex',
    models: [],
  },
  {
    id: 'grok',
    kind: 'grok',
    name: 'Grok CLI',
    enabled: false,
    authorized: false,
    cliBinary: 'grok',
    models: [],
  },
]

export function allThinkingDepthIds(): ThinkingDepth[] {
  return ['fast', 'standard', 'deep', 'max', 'ultra']
}

/** Models from enabled+authorized CLIs only */
export function modelsFromCliProviders(providers: CliProviderConfig[] | undefined): Array<
  CliModelOption & { providerId: string; providerName: string }
> {
  const out: Array<CliModelOption & { providerId: string; providerName: string }> = []
  for (const p of providers || []) {
    if (!p.enabled || !p.authorized) continue
    for (const m of p.models || []) {
      if (!m?.id) continue
      out.push({
        id: m.id,
        label: m.label || m.id,
        depths: m.depths,
        providerId: p.id,
        providerName: p.name,
      })
    }
  }
  return out
}

/** Group models by CLI provider for role-model dropdowns */
export function modelsGroupedByCliProvider(
  providers: CliProviderConfig[] | undefined,
): Array<{
  providerId: string
  providerName: string
  kind: CliKind
  models: CliModelOption[]
}> {
  const groups: Array<{
    providerId: string
    providerName: string
    kind: CliKind
    models: CliModelOption[]
  }> = []
  for (const p of providers || []) {
    if (!p.enabled || !p.authorized) continue
    const models = (p.models || []).filter((m) => m?.id)
    if (!models.length) continue
    groups.push({
      providerId: p.id,
      providerName: p.name,
      kind: p.kind,
      models: models.map((m) => ({
        id: m.id,
        label: m.label || m.id,
        depths: m.depths,
      })),
    })
  }
  return groups
}

/** Allowed thinking depths for a model id given providers */
export function depthsForModel(
  providers: CliProviderConfig[] | undefined,
  modelId: string,
): ThinkingDepth[] {
  const models = modelsFromCliProviders(providers)
  const hit = models.find((m) => m.id === modelId)
  if (hit?.depths?.length) return hit.depths
  const set = new Set<ThinkingDepth>()
  for (const m of models) {
    for (const d of m.depths || allThinkingDepthIds()) set.add(d)
  }
  return set.size ? [...set] : allThinkingDepthIds()
}

/**
 * Merge saved providers with structural templates.
 * Prefer saved models; never inject template fake models.
 * Keep unknown custom providers from saved.
 */
export function mergeCliProviders(
  saved: CliProviderConfig[] | undefined,
): CliProviderConfig[] {
  const savedList = saved || []
  const byId = new Map(savedList.map((p) => [p.id, p]))
  const merged = DEFAULT_CLI_PROVIDERS.map((def) => {
    const s = byId.get(def.id)
    if (!s) {
      return { ...def, models: [] }
    }
    byId.delete(def.id)
    return {
      ...def,
      ...s,
      id: def.id,
      kind: def.kind,
      // only use what was saved / discovered — no fallback catalog
      models: Array.isArray(s.models) ? s.models.filter((m) => m?.id) : [],
    }
  })
  // append user-defined custom providers
  for (const [, s] of byId) {
    merged.push({
      ...s,
      models: Array.isArray(s.models) ? s.models.filter((m) => m?.id) : [],
    })
  }
  return merged
}

/** Find which provider owns a model id */
export function providerForModel(
  providers: CliProviderConfig[] | undefined,
  modelId: string,
): CliProviderConfig | undefined {
  if (!modelId) return undefined
  for (const p of providers || []) {
    if (!p.enabled || !p.authorized) continue
    if ((p.models || []).some((m) => m.id === modelId)) return p
  }
  return undefined
}
