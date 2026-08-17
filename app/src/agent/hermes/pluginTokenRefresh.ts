/**
 * Schedules OAuth access-token refresh for connectors that stored a refresh_token.
 * P1-A: on Electron the exchange happens in MAIN via `secrets:refresh` using the
 * vault's refresh_token — the renderer only sees metadata. Browser dev falls back
 * to the legacy raw-record flow.
 */

import {
  getPluginSecret,
  listPluginSecretMeta,
  pluginSecretsVaultApi,
  secretNeedsRefresh,
  type PluginSecretMeta,
} from './pluginSecrets.ts'
import { oauthProviderForPlugin } from './pluginOAuth.ts'

export type RefreshClientCreds = { clientId: string; clientSecret?: string }

export type TokenRefreshDeps = {
  getClient: (clientKey: string) => RefreshClientCreds | undefined
  /**
   * Browser-fallback exchange (renderer fetch). Electron path ignores this and
   * calls window.subagents.secrets.refresh (vault-side refresh_token).
   */
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
  /** Electron: meta already persisted by main; browser: caller must persist. */
  onRefreshed: (
    pluginId: string,
    result: {
      accessToken?: string
      refreshToken?: string
      expiresIn?: number
      tokenType?: string
      meta?: PluginSecretMeta
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
  meta: PluginSecretMeta
  clientKey: string
  tokenUrl: string
  tokenAuth?: 'body' | 'basic'
}> {
  const out: Array<{
    pluginId: string
    meta: PluginSecretMeta
    clientKey: string
    tokenUrl: string
    tokenAuth?: 'body' | 'basic'
  }> = []
  for (const meta of listPluginSecretMeta()) {
    if (!secretNeedsRefresh(meta, skewMs)) continue
    const provider = oauthProviderForPlugin(meta.id)
    if (!provider?.tokenUrl || !meta.hasRefreshToken) continue
    out.push({
      pluginId: meta.id,
      meta,
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
    const vault = pluginSecretsVaultApi()
    for (const cand of listRefreshCandidates(skew)) {
      const client = deps.getClient(cand.clientKey)
      if (!client?.clientId) {
        deps.onError?.(cand.pluginId, '缺少 OAuth Client ID，無法 refresh')
        continue
      }
      try {
        if (vault) {
          // Electron: refresh_token never leaves the vault
          const r = await vault.refresh({
            pluginId: cand.pluginId,
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            tokenUrl: cand.tokenUrl,
            tokenAuth: cand.tokenAuth,
          })
          if (!r.ok) {
            deps.onError?.(cand.pluginId, r.error || 'refresh 失敗')
            continue
          }
          await deps.onRefreshed(cand.pluginId, { meta: r.meta })
          count += 1
          continue
        }
        // Browser fallback: legacy raw-record exchange
        const rec = getPluginSecret(cand.pluginId)
        if (!rec?.refreshToken) continue
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
