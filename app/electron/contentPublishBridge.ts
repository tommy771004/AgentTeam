import { shell, type WebContents } from 'electron'
import fs from 'node:fs/promises'
import {
  clearVaultSecret,
  getVaultSecret,
  isVaultEncryptionAvailable,
  listVaultMeta,
  setVaultOAuthSecret,
  type VaultMeta,
} from './secretsVault'
import {
  refreshOAuthToken,
  runPluginOAuth,
} from './oauthBridge'
import {
  OAUTH_REDIRECT_URI,
  type PluginOAuthProvider,
} from '../src/agent/hermes/pluginOAuth'
import {
  CONTENT_PUBLISH_PROVIDERS,
  composePublishText,
  contentPublishProvider,
  type ContentPublishConnectionStatus,
  type ContentPublishContent,
  type ContentPublishPlatform,
  type YouTubePrivacyStatus,
} from '../src/agent/contentPublishPlatforms'
import type { PublishAdapterResult } from '../src/agent/contentPublishAdapters'

const VAULT_PREFIX = 'content-publishing:'
const TOKEN_REFRESH_WINDOW_MS = 60_000
const DEFAULT_META_GRAPH_VERSION = 'v23.0'

type ApiResponse = {
  ok: boolean
  status: number
  json: Record<string, unknown>
  text: string
  headers: Headers
}

export type ContentPublishOAuthInput = {
  platform: ContentPublishPlatform
  clientId?: string
  clientSecret?: string
}

export type ContentPublishOAuthResult =
  | {
      ok: true
      platform: ContentPublishPlatform
      status: ContentPublishConnectionStatus
    }
  | { ok: false; platform: ContentPublishPlatform; error: string }

export type ContentPublishStatusResult = ContentPublishConnectionStatus[]

export type ContentPublishBridgeInput = Omit<ContentPublishContent, 'platform'> & {
  platform: ContentPublishPlatform
}

const providerIds = new Set<ContentPublishPlatform>([
  'instagram',
  'linkedin',
  'x',
  'facebook',
  'youtube',
])

function normalizePlatform(value: string): ContentPublishPlatform | null {
  const platform = value.trim().toLowerCase() as ContentPublishPlatform
  return providerIds.has(platform) ? platform : null
}

function vaultId(platform: ContentPublishPlatform) {
  return `${VAULT_PREFIX}${platform}`
}

function envName(platform: ContentPublishPlatform, suffix: 'CLIENT_ID' | 'CLIENT_SECRET') {
  return `CONTENT_PUBLISH_${platform.toUpperCase()}_${suffix}`
}

function configuredClient(platform: ContentPublishPlatform, input?: ContentPublishOAuthInput) {
  return {
    clientId: input?.clientId?.trim() || process.env[envName(platform, 'CLIENT_ID')]?.trim() || '',
    clientSecret:
      input?.clientSecret?.trim() || process.env[envName(platform, 'CLIENT_SECRET')]?.trim() || '',
  }
}

function graphVersion() {
  return process.env.META_GRAPH_VERSION?.trim() || DEFAULT_META_GRAPH_VERSION
}

function graphUrl(path: string) {
  return `https://graph.facebook.com/${graphVersion()}${path}`
}

function instagramGraphUrl(path: string) {
  return `https://graph.instagram.com/${graphVersion()}${path}`
}

function oauthProvider(platform: ContentPublishPlatform): PluginOAuthProvider {
  switch (platform) {
    case 'instagram':
      return {
        clientKey: 'instagram',
        flow: 'code',
        authorizeUrl: 'https://www.instagram.com/oauth/authorize',
        tokenUrl: 'https://api.instagram.com/oauth/access_token',
        scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
        tokenAuth: 'body',
        extraAuthParams: { response_type: 'code' },
        redirectPath: OAUTH_REDIRECT_URI,
        docsUrl:
          'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing',
      }
    case 'linkedin':
      return {
        clientKey: 'linkedin',
        flow: 'code',
        authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
        tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
        scopes: ['openid', 'profile', 'w_member_social'],
        tokenAuth: 'body',
        extraAuthParams: { response_type: 'code' },
        redirectPath: OAUTH_REDIRECT_URI,
        docsUrl:
          'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication',
      }
    case 'x':
      return {
        clientKey: 'x',
        flow: 'code',
        authorizeUrl: 'https://x.com/i/oauth2/authorize',
        tokenUrl: 'https://api.x.com/2/oauth2/token',
        scopes: ['tweet.read', 'users.read', 'tweet.write', 'offline.access'],
        usePkce: true,
        tokenAuth: 'body',
        extraAuthParams: { response_type: 'code' },
        redirectPath: OAUTH_REDIRECT_URI,
        docsUrl:
          'https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code',
      }
    case 'facebook':
      return {
        clientKey: 'facebook',
        flow: 'code',
        authorizeUrl: `https://www.facebook.com/${graphVersion()}/dialog/oauth`,
        tokenUrl: graphUrl('/oauth/access_token'),
        scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
        tokenAuth: 'body',
        extraAuthParams: { response_type: 'code' },
        redirectPath: OAUTH_REDIRECT_URI,
        docsUrl: 'https://developers.facebook.com/docs/facebook-login/guides/access-tokens',
      }
    case 'youtube':
      return {
        clientKey: 'youtube',
        flow: 'code',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: ['https://www.googleapis.com/auth/youtube.upload'],
        usePkce: true,
        tokenAuth: 'body',
        extraAuthParams: {
          response_type: 'code',
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
        },
        redirectPath: OAUTH_REDIRECT_URI,
        docsUrl: 'https://developers.google.com/youtube/v3/guides/authentication',
      }
  }
}

function metaStatus(
  platform: ContentPublishPlatform,
  meta?: VaultMeta,
  error?: string,
): ContentPublishConnectionStatus {
  const provider = contentPublishProvider(platform)
  return {
    platform,
    label: provider?.label || platform,
    connected: Boolean(meta?.encrypted),
    expiresAt: meta?.expiresAt,
    hasRefreshToken: Boolean(meta?.hasRefreshToken),
    encrypted: Boolean(meta?.encrypted),
    error,
  }
}

function configError(platform: ContentPublishPlatform, message: string): ContentPublishOAuthResult {
  return { ok: false, platform, error: message }
}

async function parseResponse(response: Response): Promise<ApiResponse> {
  const text = await response.text()
  let json: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
  } catch {
    // Some upload endpoints return an empty body or plain text.
  }
  return { ok: response.ok, status: response.status, json, text, headers: response.headers }
}

function apiError(response: ApiResponse, fallback: string) {
  const error = response.json.error
  const errorObject = error && typeof error === 'object' ? (error as Record<string, unknown>) : null
  const message =
    errorObject?.message ||
    response.json.message ||
    response.json.detail ||
    (typeof error === 'string' ? error : '')
  return message ? `${fallback}：${String(message)}` : `${fallback}（HTTP ${response.status}）`
}

async function bearerRequest(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<ApiResponse> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Accept', 'application/json')
  return parseResponse(await fetch(url, { ...init, headers }))
}

async function identify(platform: ContentPublishPlatform, token: string) {
  try {
    if (platform === 'linkedin') {
      const response = await bearerRequest('https://api.linkedin.com/v2/userinfo', token)
      if (!response.ok) return undefined
      return {
        accountId: typeof response.json.sub === 'string' ? response.json.sub : undefined,
        accountLabel: typeof response.json.name === 'string' ? response.json.name : undefined,
      }
    }
    if (platform === 'x') {
      const response = await bearerRequest(
        'https://api.x.com/2/users/me?user.fields=username,name',
        token,
      )
      const data = response.json.data as Record<string, unknown> | undefined
      if (!response.ok || !data) return undefined
      return {
        accountId: typeof data.id === 'string' ? data.id : undefined,
        accountLabel: typeof data.username === 'string' ? `@${data.username}` : undefined,
      }
    }
    if (platform === 'facebook') {
      const response = await bearerRequest(`${graphUrl('/me')}?fields=id,name`, token)
      if (!response.ok) return undefined
      return {
        accountId: typeof response.json.id === 'string' ? response.json.id : undefined,
        accountLabel: typeof response.json.name === 'string' ? response.json.name : undefined,
      }
    }
    if (platform === 'instagram') {
      const response = await bearerRequest(
        `${instagramGraphUrl('/me')}?fields=user_id,username`,
        token,
      )
      if (!response.ok) return undefined
      return {
        accountId: typeof response.json.user_id === 'string' ? response.json.user_id : undefined,
        accountLabel: typeof response.json.username === 'string' ? `@${response.json.username}` : undefined,
      }
    }
    const response = await bearerRequest(
      'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
      token,
    )
    const items = response.json.items as Array<Record<string, unknown>> | undefined
    const snippet = items?.[0]?.snippet as Record<string, unknown> | undefined
    if (!response.ok || !items?.[0]) return undefined
    return {
      accountId: typeof items[0].id === 'string' ? items[0].id : undefined,
      accountLabel: typeof snippet?.title === 'string' ? snippet.title : undefined,
    }
  } catch {
    return undefined
  }
}

export async function listContentPublishStatus(): Promise<ContentPublishStatusResult> {
  const metas = new Map(listVaultMeta().map((meta) => [meta.id, meta]))
  return CONTENT_PUBLISH_PROVIDERS.map(({ id }) => metaStatus(id, metas.get(vaultId(id))))
}

export async function runContentPublishOAuth(
  input: ContentPublishOAuthInput,
  wc: WebContents | null | undefined,
): Promise<ContentPublishOAuthResult> {
  const platform = normalizePlatform(input.platform)
  if (!platform) {
    return { ok: false, platform: input.platform, error: '不支援的發布平台' }
  }
  const { clientId, clientSecret } = configuredClient(platform, input)
  if (!clientId) return configError(platform, `請設定 ${envName(platform, 'CLIENT_ID')} 或輸入 Client ID`)
  const provider = oauthProvider(platform)
  const result = await runPluginOAuth(
    { pluginId: vaultId(platform), provider, clientId, clientSecret: clientSecret || undefined },
    wc,
  )
  if (!result.ok || !result.accessToken) {
    return { ok: false, platform, error: result.error || 'OAuth 授權失敗' }
  }
  let meta: VaultMeta
  try {
    meta = setVaultOAuthSecret(vaultId(platform), result.accessToken, {
      clientId,
      clientSecret: clientSecret || undefined,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      tokenType: result.tokenType,
    })
  } catch (error) {
    return {
      ok: false,
      platform,
      error: error instanceof Error ? error.message : 'OAuth token 未能安全保存',
    }
  }
  const identity = await identify(platform, result.accessToken)
  return {
    ok: true,
    platform,
    status: { ...metaStatus(platform, meta), ...identity },
  }
}

export function disconnectContentPublish(platformValue: string) {
  const platform = normalizePlatform(platformValue)
  if (!platform) return { ok: false, error: '不支援的發布平台' }
  clearVaultSecret(vaultId(platform))
  return { ok: true }
}

async function refreshInstagramToken(platform: ContentPublishPlatform, token: string) {
  const response = await parseResponse(
    await fetch(
      `${instagramGraphUrl('/refresh_access_token')}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
    ),
  )
  if (!response.ok || typeof response.json.access_token !== 'string') {
    return { ok: false as const, error: apiError(response, 'Instagram token refresh 失敗') }
  }
  const rec = getVaultSecret(vaultId(platform))
  if (!rec) return { ok: false as const, error: '找不到 Instagram vault credential' }
  let meta: VaultMeta
  try {
    meta = setVaultOAuthSecret(vaultId(platform), response.json.access_token, {
      clientId: rec.clientId || '',
      clientSecret: rec.clientSecret,
      expiresIn: Number(response.json.expires_in) || undefined,
      tokenType: typeof response.json.token_type === 'string' ? response.json.token_type : rec.tokenType,
    })
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Token 未能安全保存' }
  }
  return { ok: true as const, token: response.json.access_token, meta }
}

async function accessToken(platform: ContentPublishPlatform): Promise<
  | { ok: true; token: string }
  | { ok: false; code: 'PLATFORM_AUTH_REQUIRED' | 'PLATFORM_API_FAILED'; message: string }
> {
  const rec = getVaultSecret(vaultId(platform))
  if (!rec?.token) {
    return { ok: false, code: 'PLATFORM_AUTH_REQUIRED', message: `${platform} 尚未完成 OAuth 授權` }
  }
  if (!isVaultEncryptionAvailable()) {
    return {
      ok: false,
      code: 'PLATFORM_AUTH_REQUIRED',
      message: 'OS secure storage unavailable，為保護 Token 已停用平台 API 呼叫',
    }
  }
  if (!rec.expiresAt || rec.expiresAt > Date.now() + TOKEN_REFRESH_WINDOW_MS) {
    return { ok: true, token: rec.token }
  }

  if (platform === 'instagram') {
    const refreshed = await refreshInstagramToken(platform, rec.token)
    return refreshed.ok
      ? { ok: true, token: refreshed.token }
      : { ok: false, code: 'PLATFORM_API_FAILED', message: refreshed.error }
  }
  if (!rec.refreshToken || !rec.clientId) {
    return {
      ok: false,
      code: 'PLATFORM_AUTH_REQUIRED',
      message: `${platform} access token 已過期，請重新 OAuth 授權`,
    }
  }
  const refreshed = await refreshOAuthToken({
    pluginId: vaultId(platform),
    refreshToken: rec.refreshToken,
    clientId: rec.clientId,
    clientSecret: rec.clientSecret,
    tokenUrl: oauthProvider(platform).tokenUrl,
    tokenAuth: oauthProvider(platform).tokenAuth,
  })
  if (!refreshed.ok || !refreshed.accessToken) {
    return {
      ok: false,
      code: 'PLATFORM_API_FAILED',
      message: refreshed.error || `${platform} token refresh 失敗`,
    }
  }
  try {
    setVaultOAuthSecret(vaultId(platform), refreshed.accessToken, {
      clientId: rec.clientId,
      clientSecret: rec.clientSecret,
      refreshToken: refreshed.refreshToken,
      expiresIn: refreshed.expiresIn,
      tokenType: refreshed.tokenType,
    })
  } catch (error) {
    return {
      ok: false,
      code: 'PLATFORM_API_FAILED',
      message: error instanceof Error ? error.message : 'Token refresh 後無法安全保存',
    }
  }
  return { ok: true, token: refreshed.accessToken }
}

function failed(
  code: Extract<PublishAdapterResult, { ok: false }>['code'],
  message: string,
): PublishAdapterResult {
  return { ok: false, status: 'not-published', code, message }
}

async function publishLinkedIn(content: ContentPublishBridgeInput, token: string): Promise<PublishAdapterResult> {
  const identity = await identify('linkedin', token)
  if (!identity?.accountId) return failed('PLATFORM_API_FAILED', '無法取得 LinkedIn member identity')
  const response = await bearerRequest('https://api.linkedin.com/rest/posts', token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'Linkedin-Version': process.env.LINKEDIN_VERSION?.trim() || '202607',
    },
    body: JSON.stringify({
      author: `urn:li:person:${identity.accountId}`,
      commentary: composePublishText(content.title, content.body),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareByAuthor: false,
    }),
  })
  return response.ok
    ? { ok: true, status: 'published', externalId: response.headers.get('x-restli-id') || undefined }
    : failed('PLATFORM_API_FAILED', apiError(response, 'LinkedIn 發布失敗'))
}

async function publishX(content: ContentPublishBridgeInput, token: string): Promise<PublishAdapterResult> {
  const response = await bearerRequest('https://api.x.com/2/tweets', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: composePublishText(content.title, content.body) }),
  })
  const data = response.json.data as Record<string, unknown> | undefined
  return response.ok && typeof data?.id === 'string'
    ? { ok: true, status: 'published', externalId: data.id }
    : failed('PLATFORM_API_FAILED', apiError(response, 'X 發布失敗'))
}

async function publishFacebook(content: ContentPublishBridgeInput, token: string): Promise<PublishAdapterResult> {
  const pages = await bearerRequest(
    `${graphUrl('/me/accounts')}?fields=id,name,access_token`,
    token,
  )
  const pageData = pages.json.data as Array<Record<string, unknown>> | undefined
  const page = content.targetId
    ? pageData?.find((item) => item.id === content.targetId)
    : pageData?.[0]
  if (!pages.ok || !page || typeof page.id !== 'string' || typeof page.access_token !== 'string') {
    return failed('PLATFORM_API_FAILED', apiError(pages, 'Facebook Page 授權取得失敗'))
  }
  const response = await bearerRequest(graphUrl(`/${page.id}/feed`), page.access_token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: composePublishText(content.title, content.body) }),
  })
  const id = typeof response.json.id === 'string' ? response.json.id : undefined
  return response.ok && id
    ? { ok: true, status: 'published', externalId: id }
    : failed('PLATFORM_API_FAILED', apiError(response, 'Facebook Page 發布失敗'))
}

async function publishInstagram(content: ContentPublishBridgeInput, token: string): Promise<PublishAdapterResult> {
  if (!content.mediaUrl || !/^https?:\/\//i.test(content.mediaUrl)) {
    return failed('PLATFORM_MEDIA_REQUIRED', 'Instagram 需要可公開存取的 image URL，尚未發布')
  }
  const identity = await bearerRequest(`${instagramGraphUrl('/me')}?fields=user_id`, token)
  const userId = typeof identity.json.user_id === 'string' ? identity.json.user_id : undefined
  if (!identity.ok || !userId) return failed('PLATFORM_API_FAILED', apiError(identity, 'Instagram 帳號取得失敗'))
  const container = await bearerRequest(instagramGraphUrl(`/${userId}/media`), token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: content.mediaUrl,
      caption: composePublishText(content.title, content.body),
    }),
  })
  const creationId = typeof container.json.id === 'string' ? container.json.id : undefined
  if (!container.ok || !creationId) {
    return failed('PLATFORM_API_FAILED', apiError(container, 'Instagram media container 建立失敗'))
  }
  const published = await bearerRequest(instagramGraphUrl(`/${userId}/media_publish`), token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId }),
  })
  const id = typeof published.json.id === 'string' ? published.json.id : undefined
  return published.ok && id
    ? { ok: true, status: 'published', externalId: id }
    : failed('PLATFORM_API_FAILED', apiError(published, 'Instagram 發布失敗'))
}

function youtubePrivacyStatus(value: YouTubePrivacyStatus | undefined) {
  return value === 'public' || value === 'unlisted' || value === 'private' ? value : 'private'
}

async function publishYouTube(content: ContentPublishBridgeInput, token: string): Promise<PublishAdapterResult> {
  if (!content.mediaPath) return failed('PLATFORM_MEDIA_REQUIRED', 'YouTube 需要影片檔案路徑，尚未發布')
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(content.mediaPath)
  } catch {
    return failed('PLATFORM_MEDIA_REQUIRED', '找不到 YouTube 影片檔案，尚未發布')
  }
  if (!stat.isFile() || stat.size <= 0) return failed('PLATFORM_MEDIA_REQUIRED', 'YouTube 影片檔案無效，尚未發布')
  const mime = content.mediaMimeType || 'video/mp4'
  const initiate = await bearerRequest(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(stat.size),
        'X-Upload-Content-Type': mime,
      },
      body: JSON.stringify({
        snippet: {
          title: content.title.trim() || 'Untitled',
          description: content.body.trim(),
        },
        status: { privacyStatus: youtubePrivacyStatus(content.privacyStatus) },
      }),
    },
  )
  const location = initiate.headers.get('location')
  if (!initiate.ok || !location) return failed('PLATFORM_API_FAILED', apiError(initiate, 'YouTube upload 初始化失敗'))
  let upload: ApiResponse
  try {
    const bytes = await fs.readFile(content.mediaPath)
    upload = await parseResponse(
      await fetch(location, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mime,
          'Content-Length': String(bytes.byteLength),
        },
        body: bytes,
      }),
    )
  } catch (error) {
    return failed('PLATFORM_API_FAILED', `YouTube upload 失敗：${error instanceof Error ? error.message : String(error)}`)
  }
  const id = typeof upload.json.id === 'string' ? upload.json.id : undefined
  return upload.ok && id
    ? { ok: true, status: 'published', externalId: id }
    : failed('PLATFORM_API_FAILED', apiError(upload, 'YouTube 發布失敗'))
}

export async function publishContent(
  input: ContentPublishBridgeInput,
): Promise<PublishAdapterResult> {
  const platform = normalizePlatform(input.platform)
  if (!platform) return failed('PLATFORM_API_FAILED', '不支援的發布平台')
  const spec = contentPublishProvider(platform)
  if (!spec) return failed('PLATFORM_API_FAILED', '找不到發布平台設定')
  if (!composePublishText(input.title, input.body) && platform !== 'youtube') {
    return failed('PLATFORM_API_FAILED', `${spec.label} 內容不可為空白`)
  }
  const access = await accessToken(platform)
  if (!access.ok) return failed(access.code, access.message)
  switch (platform) {
    case 'linkedin':
      return publishLinkedIn(input, access.token)
    case 'x':
      return publishX(input, access.token)
    case 'facebook':
      return publishFacebook(input, access.token)
    case 'instagram':
      return publishInstagram(input, access.token)
    case 'youtube':
      return publishYouTube(input, access.token)
  }
}

export async function openContentPublishDocs(platformValue: string) {
  const platform = normalizePlatform(platformValue)
  const docs = platform && contentPublishProvider(platform)?.docsUrl
  if (!docs) return { ok: false, error: '找不到平台文件' }
  await shell.openExternal(docs)
  return { ok: true }
}
