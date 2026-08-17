import type { ModelProfile } from '../types.ts'

export type OpenCodeProviderCatalog = {
  providers?: Array<{
    id?: string
    name?: string
    models?: Record<string, { limit?: { context?: number; output?: number }; modalities?: { input?: string[] } }>
  }>
  default?: Record<string, string>
}

/** Convert server-discovered models into non-destructive candidate profiles. */
export function mapOpenCodeProviderCatalog(
  catalog: OpenCodeProviderCatalog | null | undefined,
): { modelIds: string[]; profiles: Record<string, ModelProfile> } {
  const modelIds: string[] = []
  const profiles: Record<string, ModelProfile> = {}
  for (const provider of catalog?.providers || []) {
    const providerId = String(provider.id || '').trim()
    if (!providerId) continue
    for (const [modelId, meta] of Object.entries(provider.models || {})) {
      const id = modelId.includes('/') ? modelId : `${providerId}/${modelId}`
      modelIds.push(id)
      const input = meta.modalities?.input || []
      profiles[id] = {
        modelId: id,
        source: 'discovered',
        contextWindow: meta.limit?.context,
        vision: input.some((item) => /image|vision/i.test(item)),
        note: `OpenCode provider discovery · ${provider.name || providerId} · discovered（不覆寫使用者選擇）`,
      }
    }
  }
  return { modelIds: [...new Set(modelIds)].sort(), profiles }
}
