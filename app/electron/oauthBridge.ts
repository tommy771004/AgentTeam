/**
 * Desktop OAuth: device-code (GitHub) + authorization-code loopback (Notion/Google/…).
 */
import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { shell, type WebContents } from 'electron'
import {
  OAUTH_LOOPBACK_PORT,
  OAUTH_REDIRECT_URI,
  type PluginOAuthProvider,
} from '../src/agent/hermes/pluginOAuth'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export type OAuthRunInput = {
  pluginId: string
  provider: PluginOAuthProvider
  clientId: string
  clientSecret?: string
}

export type OAuthStatusPayload = {
  pluginId: string
  phase: 'starting' | 'device' | 'browser' | 'polling' | 'exchanging' | 'done' | 'error'
  userCode?: string
  verificationUri?: string
  message?: string
  error?: string
}

export type OAuthRunResult = {
  ok: boolean
  pluginId: string
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  tokenType?: string
  error?: string
  raw?: unknown
}

let activeAbort: AbortController | null = null
let activeServer: http.Server | null = null

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function emit(wc: WebContents | null | undefined, payload: OAuthStatusPayload) {
  try {
    wc?.send('oauth:status', payload)
  } catch {
    /* destroyed */
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('已取消'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
    signal,
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    // GitHub sometimes returns form-encoded
    const params = new URLSearchParams(text)
    params.forEach((v, k) => {
      json[k] = v
    })
  }
  return { status: res.status, json, text }
}

export function cancelOAuth() {
  activeAbort?.abort()
  activeAbort = null
  if (activeServer) {
    try {
      activeServer.close()
    } catch {
      /* ignore */
    }
    activeServer = null
  }
}

async function runDeviceFlow(
  input: OAuthRunInput,
  wc: WebContents | null | undefined,
  signal: AbortSignal,
): Promise<OAuthRunResult> {
  const { provider, clientId, pluginId } = input
  if (!provider.deviceCodeUrl) {
    return { ok: false, pluginId, error: '此供應商不支援裝置碼流程' }
  }

  emit(wc, { pluginId, phase: 'starting', message: '向供應商申請裝置碼…' })
  const started = await postForm(
    provider.deviceCodeUrl,
    {
      client_id: clientId,
      scope: provider.scopes.join(' '),
    },
    {},
    signal,
  )
  if (started.status >= 400 || !started.json.device_code) {
    return {
      ok: false,
      pluginId,
      error: String(started.json.error_description || started.json.error || started.text || '裝置碼申請失敗'),
      raw: started.json,
    }
  }

  const deviceCode = String(started.json.device_code)
  const userCode = String(started.json.user_code || '')
  const verificationUri = String(
    started.json.verification_uri_complete || started.json.verification_uri || 'https://github.com/login/device',
  )
  const intervalSec = Math.max(3, Number(started.json.interval) || 5)
  const expiresIn = Number(started.json.expires_in) || 900

  emit(wc, {
    pluginId,
    phase: 'device',
    userCode,
    verificationUri,
    message: `在瀏覽器輸入代碼 ${userCode}`,
  })
  void shell.openExternal(verificationUri)

  const deadline = Date.now() + Math.min(expiresIn * 1000, DEFAULT_TIMEOUT_MS)
  emit(wc, { pluginId, phase: 'polling', message: '等待你在瀏覽器完成授權…' })

  while (Date.now() < deadline) {
    if (signal.aborted) return { ok: false, pluginId, error: '已取消' }
    await sleep(intervalSec * 1000, signal)
    const poll = await postForm(
      provider.tokenUrl,
      {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
      {},
      signal,
    )
    if (poll.json.access_token) {
      return {
        ok: true,
        pluginId,
        accessToken: String(poll.json.access_token),
        refreshToken: poll.json.refresh_token ? String(poll.json.refresh_token) : undefined,
        expiresIn: poll.json.expires_in ? Number(poll.json.expires_in) : undefined,
        tokenType: poll.json.token_type ? String(poll.json.token_type) : undefined,
        raw: poll.json,
      }
    }
    const err = String(poll.json.error || '')
    if (err === 'authorization_pending' || err === 'slow_down') {
      continue
    }
    if (err === 'expired_token' || err === 'access_denied') {
      return {
        ok: false,
        pluginId,
        error: String(poll.json.error_description || err),
        raw: poll.json,
      }
    }
    if (poll.status >= 400 && err) {
      return {
        ok: false,
        pluginId,
        error: String(poll.json.error_description || err),
        raw: poll.json,
      }
    }
  }
  return { ok: false, pluginId, error: '授權逾時' }
}

function waitForAuthCode(
  expectedState: string,
  signal: AbortSignal,
): Promise<{ code: string } | { error: string }> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ error: '已取消' })
      return
    }
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${OAUTH_LOOPBACK_PORT}`)
        if (url.pathname !== '/oauth/callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const err = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const html = `<!doctype html><html><body style="font-family:'Segoe WPC','Segoe UI',-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display',system-ui,sans-serif;padding:2rem;background:#0b0f14;color:#e8eef6">
          <h2>${err ? '授權失敗' : '授權完成'}</h2>
          <p>${err ? err : '可以關閉此分頁，回到 SubAgents AI。'}</p>
          <script>setTimeout(()=>window.close(),800)</script>
        </body></html>`
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
        cleanup()
        if (err) resolve({ error: err })
        else if (!code) resolve({ error: '回呼缺少 code' })
        else if (state !== expectedState) resolve({ error: 'state 不符，可能遭竄改' })
        else resolve({ code })
      } catch (e) {
        cleanup()
        resolve({ error: e instanceof Error ? e.message : String(e) })
      }
    })
    activeServer = server

    const onAbort = () => {
      cleanup()
      resolve({ error: '已取消' })
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      try {
        server.close()
      } catch {
        /* ignore */
      }
      if (activeServer === server) activeServer = null
    }

    server.once('error', (e) => {
      cleanup()
      resolve({ error: e instanceof Error ? e.message : String(e) })
    })
    server.listen(OAUTH_LOOPBACK_PORT, '127.0.0.1')
  })
}

async function runCodeFlow(
  input: OAuthRunInput,
  wc: WebContents | null | undefined,
  signal: AbortSignal,
): Promise<OAuthRunResult> {
  const { provider, clientId, clientSecret, pluginId } = input
  if (!provider.authorizeUrl) {
    return { ok: false, pluginId, error: '此供應商缺少 authorizeUrl' }
  }
  if (provider.tokenAuth === 'basic' && !clientSecret) {
    return { ok: false, pluginId, error: '此供應商需要 Client Secret' }
  }

  const state = b64url(randomBytes(16))
  const pkce = provider.usePkce ? pkcePair() : null
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    state,
    ...(provider.scopes.length ? { scope: provider.scopes.join(' ') } : {}),
    ...(provider.extraAuthParams || {}),
  })
  if (pkce) {
    params.set('code_challenge', pkce.challenge)
    params.set('code_challenge_method', 'S256')
  }

  emit(wc, {
    pluginId,
    phase: 'browser',
    message: `請在瀏覽器完成授權（回呼 ${OAUTH_REDIRECT_URI}）`,
  })

  const codeWait = waitForAuthCode(state, signal)
  await shell.openExternal(`${provider.authorizeUrl}?${params.toString()}`)
  const codeResult = await codeWait
  if ('error' in codeResult) {
    return { ok: false, pluginId, error: codeResult.error }
  }

  emit(wc, { pluginId, phase: 'exchanging', message: '交換 access token…' })
  const tokenBody: Record<string, string> = {
    grant_type: 'authorization_code',
    code: codeResult.code,
    redirect_uri: OAUTH_REDIRECT_URI,
    client_id: clientId,
  }
  if (clientSecret && provider.tokenAuth !== 'basic') {
    tokenBody.client_secret = clientSecret
  }
  if (pkce) tokenBody.code_verifier = pkce.verifier

  const headers: Record<string, string> = {}
  if (provider.tokenAuth === 'basic') {
    const basic = Buffer.from(`${clientId}:${clientSecret || ''}`).toString('base64')
    headers.Authorization = `Basic ${basic}`
  }

  const tokenRes = await postForm(provider.tokenUrl, tokenBody, headers, signal)
  // Notion returns access_token in JSON; some put it under data
  const access =
    tokenRes.json.access_token ||
    (tokenRes.json.data as Record<string, unknown> | undefined)?.access_token
  if (!access) {
    return {
      ok: false,
      pluginId,
      error: String(
        tokenRes.json.error_description ||
          tokenRes.json.error ||
          tokenRes.text ||
          'token 交換失敗',
      ),
      raw: tokenRes.json,
    }
  }
  return {
    ok: true,
    pluginId,
    accessToken: String(access),
    refreshToken: tokenRes.json.refresh_token ? String(tokenRes.json.refresh_token) : undefined,
    expiresIn: tokenRes.json.expires_in ? Number(tokenRes.json.expires_in) : undefined,
    tokenType: tokenRes.json.token_type ? String(tokenRes.json.token_type) : undefined,
    raw: tokenRes.json,
  }
}

export async function refreshOAuthToken(input: {
  pluginId: string
  refreshToken: string
  clientId: string
  clientSecret?: string
  tokenUrl: string
  tokenAuth?: 'body' | 'basic'
}): Promise<OAuthRunResult> {
  const { pluginId, refreshToken, clientId, clientSecret, tokenUrl, tokenAuth } = input
  if (!refreshToken?.trim()) {
    return { ok: false, pluginId, error: '缺少 refresh_token' }
  }
  if (!clientId?.trim()) {
    return { ok: false, pluginId, error: '缺少 Client ID' }
  }
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken.trim(),
    client_id: clientId.trim(),
  }
  const headers: Record<string, string> = {}
  if (tokenAuth === 'basic') {
    if (!clientSecret) return { ok: false, pluginId, error: '此供應商 refresh 需要 Client Secret' }
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  } else if (clientSecret) {
    body.client_secret = clientSecret
  }
  try {
    const res = await postForm(tokenUrl, body, headers)
    const access =
      res.json.access_token ||
      (res.json.data as Record<string, unknown> | undefined)?.access_token
    if (!access) {
      return {
        ok: false,
        pluginId,
        error: String(res.json.error_description || res.json.error || res.text || 'refresh 失敗'),
        raw: res.json,
      }
    }
    return {
      ok: true,
      pluginId,
      accessToken: String(access),
      // Some providers rotate refresh tokens
      refreshToken: res.json.refresh_token ? String(res.json.refresh_token) : refreshToken,
      expiresIn: res.json.expires_in ? Number(res.json.expires_in) : undefined,
      tokenType: res.json.token_type ? String(res.json.token_type) : undefined,
      raw: res.json,
    }
  } catch (e) {
    return { ok: false, pluginId, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Browser-safe refresh via fetch (same form as main process). */
export async function refreshOAuthTokenHttp(input: {
  pluginId: string
  refreshToken: string
  clientId: string
  clientSecret?: string
  tokenUrl: string
  tokenAuth?: 'body' | 'basic'
}): Promise<OAuthRunResult> {
  return refreshOAuthToken(input)
}

export async function runPluginOAuth(
  input: OAuthRunInput,
  wc: WebContents | null | undefined,
): Promise<OAuthRunResult> {
  cancelOAuth()
  const ac = new AbortController()
  activeAbort = ac
  const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS)
  try {
    if (!input.clientId?.trim()) {
      return { ok: false, pluginId: input.pluginId, error: '需要 Client ID' }
    }
    const result =
      input.provider.flow === 'device'
        ? await runDeviceFlow(input, wc, ac.signal)
        : await runCodeFlow(input, wc, ac.signal)
    emit(wc, {
      pluginId: input.pluginId,
      phase: result.ok ? 'done' : 'error',
      message: result.ok ? '授權成功' : result.error,
      error: result.error,
    })
    return result
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    emit(wc, { pluginId: input.pluginId, phase: 'error', error })
    return { ok: false, pluginId: input.pluginId, error }
  } finally {
    clearTimeout(timer)
    if (activeAbort === ac) activeAbort = null
  }
}
