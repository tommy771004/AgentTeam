import { useCallback, useEffect, useState } from 'react'
import type { SubscriptionProviderCatalog } from '../agent/subscriptionCatalog'

/**
 * The ONE loader for the Host snapshot's subscription catalog (ticket 01).
 *
 * Both settings surfaces read through here so their loading behavior can never
 * drift apart, and so the offline-fallback metadata (`stale` / `cachedAt`)
 * travels with the rows instead of being re-derived per component.
 *
 * Beyond mount-time load, the query re-fires when the window regains focus or
 * becomes visible: a provider conflict resolved OUTSIDE this app (a CLI
 * logout) must become observable in Settings without a remount — fail-closed
 * healing you cannot see is not healed.
 */
export function useSubscriptionCatalog(): {
  catalog: readonly SubscriptionProviderCatalog[] | undefined
  stale: boolean
  cachedAt: number | undefined
  loadFailed: boolean
  refresh: () => void
} {
  const [catalog, setCatalog] = useState<readonly SubscriptionProviderCatalog[]>()
  const [stale, setStale] = useState(false)
  const [cachedAt, setCachedAt] = useState<number>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    void window.subagents?.piHost?.settings?.get?.().then((result) => {
      if (!active) return
      // Older Hosts (protocol < v4) carry no catalog: nothing selectable is
      // invented behind their back. A success also clears a previous load
      // failure — healing must be able to end the error state, not just
      // silently coexist with it.
      setLoadFailed(false)
      setCatalog(result?.config?.subscriptionCatalog)
      setStale(Boolean(result?.config?.subscriptionCatalogStale))
      setCachedAt(result?.config?.subscriptionCatalogCachedAt)
    }).catch(() => {
      if (active) setLoadFailed(true)
    })
    return () => { active = false }
  }, [attempt])

  useEffect(() => {
    const requery = () => {
      if (document.visibilityState === 'hidden') return
      setAttempt((value) => value + 1)
    }
    window.addEventListener('focus', requery)
    document.addEventListener('visibilitychange', requery)
    return () => {
      window.removeEventListener('focus', requery)
      document.removeEventListener('visibilitychange', requery)
    }
  }, [])

  const refresh = useCallback(() => setAttempt((value) => value + 1), [])
  return { catalog, stale, cachedAt, loadFailed, refresh }
}

/** 「過期快取」的如實標示文字；cachedAt 缺席時只標示過期。 */
export function subscriptionCacheBadge(cachedAt: number | undefined): string {
  const when = typeof cachedAt === 'number' && cachedAt > 0 && Number.isFinite(cachedAt)
    ? new Date(cachedAt).toLocaleString()
    : ''
  return when ? `離線快取（建立於 ${when}）` : '離線快取'
}
