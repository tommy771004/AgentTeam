/**
 * SubDesign model discovery — aggregates CLI provider models, Pi Host
 * settings already available through typed renderer bridges.
 *
 * Mirrors open-design's per-adapter listModels + fallbackModel contract:
 * every CLI def carries discovered models; the UI shows what is actually
 * available instead of a hard-coded catalog.
 */

import { modelsFromCliProviders, type CliModelOption, type CliProviderConfig } from '../cliProviders.ts'

export type SubDesignModelOption = CliModelOption & {
  providerId: string
  providerName: string
  source: 'cli' | 'discovered' | 'host'
}

export type SubDesignModelDiscovery = {
  models: SubDesignModelOption[]
  current: { provider: string; model: string; thinkingLevel: string }
  /** How many came from each source — for the empty-state hint */
  sourceCounts: { cli: number; discovered: number; host: number }
}

/**
 * Collect models synchronously from what the renderer already knows:
 * - CLI providers (enabled+authorized, each with its discovered models)
 * - legacy discoveredModels string list (OpenAI-compatible baseUrl probe)
 * - current Pi Host provider/model as a fallback entry when nothing else exists
 */
export function collectSubDesignModels(input: {
  cliProviders?: CliProviderConfig[]
  discoveredModels?: string[]
  host?: { provider: string; model: string; thinkingLevel: string } | null
}): SubDesignModelDiscovery {
  const cliModels = modelsFromCliProviders(input.cliProviders).map((m) => ({
    ...m,
    source: 'cli' as const,
  }))

  const discoveredSource = (input.discoveredModels || [])
    .filter((id) => Boolean(id && id.trim()))
    .filter((id) => !cliModels.some((m) => m.id === id))
    .map<SubDesignModelOption>((id) => ({
      id,
      label: id,
      providerId: 'discovered',
      providerName: '已發現模型',
      source: 'discovered',
    }))

  const hostFallback: SubDesignModelOption[] = []
  if (input.host?.model && !cliModels.some((m) => m.id === input.host!.model) && !discoveredSource.some((m) => m.id === input.host!.model)) {
    hostFallback.push({
      id: input.host.model,
      label: input.host.model,
      providerId: input.host.provider || 'host',
      providerName: input.host.provider || '目前 Host',
      source: 'host',
    })
  }

  const models = [...cliModels, ...discoveredSource, ...hostFallback]
  const current = {
    provider: input.host?.provider || '',
    model: input.host?.model || '',
    thinkingLevel: input.host?.thinkingLevel || 'medium',
  }
  return {
    models,
    current,
    sourceCounts: { cli: cliModels.length, discovered: discoveredSource.length, host: hostFallback.length },
  }
}

export function readHostModelSettings(): Promise<{ provider: string; model: string; thinkingLevel: string } | null> {
  const api = window.subagents?.piHost?.settings?.get
  if (!api) return Promise.resolve(null)
  return api()
    .then((result) => {
      const s = result.settings
      if (!s) return null
      return { provider: s.provider || '', model: s.model || '', thinkingLevel: s.thinkingLevel || 'medium' }
    })
    .catch(() => null)
}
