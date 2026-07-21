/**
 * Company Classification Endpoint client (`/v1` exact URL).
 * Additive exclusions only; max 3 attempts; transient retries only.
 */

export type ClassifierAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'header'; name: string; value: string }

export type ClassifierRequest = {
  workspaceId?: string
  managedDeviceId?: string
  providerId: string
  sourceKind: 'prompt' | 'history' | 'system' | 'tool_result' | 'file' | 'attachment'
  sourceName: string
  chunk: string
  locator?: { startLine?: number; endLine?: number; page?: number; sheet?: string; cell?: string }
}

export type ClassifierExclusion = {
  startLine?: number
  endLine?: number
  page?: number
  sheet?: string
  cell?: string
  label?: string
}

export type ClassifierCallResult =
  | {
      ok: true
      status: 'ok' | 'degraded'
      exclusions: ClassifierExclusion[]
      attempts: number
      transport: 'https' | 'http'
      url: string
    }
  | {
      ok: false
      status: 'degraded' | 'config_error'
      reason: string
      attempts: number
      url?: string
    }

export type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    redirect: 'error' | 'manual' | 'follow'
  },
) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}>

const MAX_ATTEMPTS = 3

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function isTransientError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /timeout|network|ECONN|ENOTFOUND|fetch failed|aborted/i.test(msg)
}

/**
 * POST structured classification request to the exact configured URL.
 * Never appends path segments; uses redirect:'error'.
 */
export async function callCompanyClassifier(opts: {
  endpointUrl: string
  request: ClassifierRequest
  auth?: ClassifierAuth
  /** Company-approved plaintext HTTP when true; recorded as unencrypted. */
  allowPlaintextHttp?: boolean
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
}): Promise<ClassifierCallResult> {
  const url = String(opts.endpointUrl || '').trim()
  if (!url) {
    return {
      ok: false,
      status: 'degraded',
      reason: 'classifier endpoint not configured',
      attempts: 0,
    }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return {
      ok: false,
      status: 'config_error',
      reason: 'classifier endpoint URL invalid',
      attempts: 0,
      url,
    }
  }

  const isHttps = parsed.protocol === 'https:'
  const isHttp = parsed.protocol === 'http:'
  if (!isHttps && !isHttp) {
    return {
      ok: false,
      status: 'config_error',
      reason: 'classifier endpoint must be http(s)',
      attempts: 0,
      url,
    }
  }
  if (isHttp && !opts.allowPlaintextHttp) {
    return {
      ok: false,
      status: 'config_error',
      reason: 'plaintext HTTP classifier requires explicit company approval (allowPlaintextHttp)',
      attempts: 0,
      url,
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const auth = opts.auth || { type: 'none' }
  if (auth.type === 'bearer') {
    headers.Authorization = `Bearer ${auth.token}`
  } else if (auth.type === 'header') {
    headers[auth.name] = auth.value
  }

  const body = JSON.stringify({
    workspaceId: opts.request.workspaceId ?? null,
    managedDeviceId: opts.request.managedDeviceId ?? null,
    providerId: opts.request.providerId,
    sourceKind: opts.request.sourceKind,
    sourceName: opts.request.sourceName,
    chunk: opts.request.chunk,
    locator: opts.request.locator ?? null,
  })

  const fetchImpl = opts.fetchImpl || (globalThis.fetch as unknown as FetchLike)
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))

  let attempts = 0
  let lastReason = 'unknown'

  while (attempts < MAX_ATTEMPTS) {
    attempts++
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
      })

      // Auth / client errors — do not retry, do not anonymous fallback
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          status: 'config_error',
          reason: `classifier authentication failed (HTTP ${res.status})`,
          attempts,
          url,
        }
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return {
          ok: false,
          status: 'config_error',
          reason: `classifier client error (HTTP ${res.status})`,
          attempts,
          url,
        }
      }

      if (!res.ok && isTransientStatus(res.status)) {
        lastReason = `transient HTTP ${res.status}`
        if (attempts < MAX_ATTEMPTS) await sleep(10 * attempts)
        continue
      }

      if (!res.ok) {
        return {
          ok: false,
          status: 'degraded',
          reason: `classifier HTTP ${res.status}`,
          attempts,
          url,
        }
      }

      let data: unknown
      try {
        data = await res.json()
      } catch {
        return {
          ok: false,
          status: 'config_error',
          reason: 'classifier invalid JSON response',
          attempts,
          url,
        }
      }

      const exclusions = parseAdditiveExclusions(data)
      if (exclusions == null) {
        return {
          ok: false,
          status: 'config_error',
          reason: 'classifier invalid response schema',
          attempts,
          url,
        }
      }

      return {
        ok: true,
        status: 'ok',
        exclusions,
        attempts,
        transport: isHttps ? 'https' : 'http',
        url,
      }
    } catch (e) {
      // redirect:error throws / network
      const msg = e instanceof Error ? e.message : String(e)
      if (/redirect/i.test(msg)) {
        return {
          ok: false,
          status: 'config_error',
          reason: 'classifier redirect denied',
          attempts,
          url,
        }
      }
      if (isTransientError(e) && attempts < MAX_ATTEMPTS) {
        lastReason = msg
        await sleep(10 * attempts)
        continue
      }
      lastReason = msg
      break
    }
  }

  return {
    ok: false,
    status: 'degraded',
    reason: `classifier unavailable after ${attempts} attempts (${lastReason}); continue with baseline`,
    attempts,
    url,
  }
}

/** Response may only add exclusions — no remove/release fields honored. */
function parseAdditiveExclusions(data: unknown): ClassifierExclusion[] | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  // Reject if server tries to remove baseline findings
  if (o.removeExclusions != null || o.release != null || o.disableBaseline != null) {
    return null
  }
  const raw = o.exclusions ?? o.additions ?? o.findings
  if (!Array.isArray(raw)) return []
  const out: ClassifierExclusion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    out.push({
      startLine: typeof e.startLine === 'number' ? e.startLine : undefined,
      endLine: typeof e.endLine === 'number' ? e.endLine : undefined,
      page: typeof e.page === 'number' ? e.page : undefined,
      sheet: typeof e.sheet === 'string' ? e.sheet : undefined,
      cell: typeof e.cell === 'string' ? e.cell : undefined,
      label: typeof e.label === 'string' ? e.label.slice(0, 64) : undefined,
    })
  }
  return out
}

/** Settings connection test — synthetic content only. */
export function syntheticClassifierTestRequest(providerId: string): ClassifierRequest {
  return {
    providerId,
    sourceKind: 'prompt',
    sourceName: 'connection-test',
    chunk: 'SYNTHETIC_CLASSIFIER_PROBE_NO_USER_DATA',
    locator: { startLine: 1, endLine: 1 },
  }
}

/**
 * Merge classifier exclusions into an existing list (additive only).
 * Never removes baseline exclusions.
 */
export function mergeAdditiveExclusions<T extends { startLine?: number; endLine?: number }>(
  baseline: T[],
  added: ClassifierExclusion[],
): T[] {
  const out = [...baseline]
  for (const a of added) {
    out.push({
      startLine: a.startLine,
      endLine: a.endLine,
    } as T)
  }
  return out
}
