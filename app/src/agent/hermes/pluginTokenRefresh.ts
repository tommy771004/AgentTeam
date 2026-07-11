/**
 * Schedules OAuth access-token refresh for connectors that stored a refresh_token.
 * Pure timer + callbacks; actual HTTP lives in Electron `oauth:refresh` or fetch fallback.
 */

import {
  getPluginSecret,
  listPluginSecrets,
  secretNeedsRefresh,
  type PluginSecretRecord,
} from './pluginSecrets'
import { oauthProviderForPlugin } from './pluginOAuth'

export type RefreshClientCreds = { clientId: string; clientSecret?: string }

export type TokenRefreshDeps = {
  getClient: (clientKey: string) => RefreshClientCreds | undefined
  refresh: (input: {
    pluginId: string
    refreshToken: string
    clientId: string
    clientSecret?: string
    tokenUrl: string
    tokenAuth?: 'body' | 'basic'
  }) => Promise<{
    ok: boolean
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
    tokenType?: string
    error?: string
  }>
  onRefreshed: (
    pluginId: string,
    result: {
      accessToken: string
      refreshToken?: string
      expiresIn?: number
      tokenType?: string
    },
  ) => void | Promise<void>
  onError?: (pluginId: string, error: string) => void
  /** Poll interval (default 60s) */
  intervalMs?: number
  skewMs?: number
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export function listRefreshCandidates(skewMs = 5 * 60 * 1000): Array<{
  pluginId: string
  record: PluginSecretRecord
  clientKey: string
  tokenUrl: string
  tokenAuth?: 'body' | 'basic'
}> {
  const out: Array<{
    pluginId: string
    record: PluginSecretRecord
    clientKey: string
    tokenUrl: string
    tokenAuth?: 'body' | 'basic'
  }> = []
  for (const { id, record } of listPluginSecrets()) {
    if (!secretNeedsRefresh(record, skewMs)) continue
    const provider = oauthProviderForPlugin(id)
    if (!provider?.tokenUrl || !record.refreshToken) continue
    // GitHub device tokens often have no refresh_token; skip if none
    out.push({
      pluginId: id,
      record,
      clientKey: provider.clientKey,
      tokenUrl: provider.tokenUrl,
      tokenAuth: provider.tokenAuth,
    })
  }
  return out
}

export async function refreshDueTokens(deps: TokenRefreshDeps): Promise<number> {
  if (running) return 0
  running = true
  let count = 0
  try {
    const skew = deps.skewMs ?? 5 * 60 * 1000
    for (const cand of listRefreshCandidates(skew)) {
      const client = deps.getClient(cand.clientKey)
      if (!client?.clientId) {
        deps.onError?.(cand.pluginId, '缺少 OAuth Client ID，無法 refresh')
        continue
      }
      const rec = getPluginSecret(cand.pluginId)
      if (!rec?.refreshToken) continue
      try {
        const result = await deps.refresh({
          pluginId: cand.pluginId,
          refreshToken: rec.refreshToken,
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          tokenUrl: cand.tokenUrl,
          tokenAuth: cand.tokenAuth,
        })
        if (!result.ok || !result.accessToken) {
          deps.onError?.(cand.pluginId, result.error || 'refresh 失敗')
          continue
        }
        await deps.onRefreshed(cand.pluginId, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
          tokenType: result.tokenType,
        })
        count += 1
      } catch (e) {
        deps.onError?.(cand.pluginId, e instanceof Error ? e.message : String(e))
      }
    }
  } finally {
    running = false
  }
  return count
}

export function startPluginTokenRefreshScheduler(deps: TokenRefreshDeps) {
  stopPluginTokenRefreshScheduler()
  const interval = deps.intervalMs ?? 60_000
  // Kick once soon after start
  void refreshDueTokens(deps)
  timer = setInterval(() => {
    void refreshDueTokens(deps)
  }, interval)
  return () => stopPluginTokenRefreshScheduler()
}

export function stopPluginTokenRefreshScheduler() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
