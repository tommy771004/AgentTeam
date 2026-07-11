/**
 * OAuth provider configs for connector plugins.
 * Shared by renderer catalog UI and Electron main (via relative import).
 */

export type OAuthFlowKind = 'device' | 'code'

export type PluginOAuthProvider = {
  /** Settings key under pluginOAuthClients */
  clientKey: string
  flow: OAuthFlowKind
  authorizeUrl?: string
  tokenUrl: string
  deviceCodeUrl?: string
  scopes: string[]
  usePkce?: boolean
  /** Notion uses Basic client_id:client_secret on token exchange */
  tokenAuth?: 'body' | 'basic'
  extraAuthParams?: Record<string, string>
  /** Human-readable redirect URI users must register (code flow) */
  redirectPath?: string
  docsUrl?: string
}

/** Fixed loopback port so OAuth app redirect URIs stay stable */
export const OAUTH_LOOPBACK_PORT = 19789
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_LOOPBACK_PORT}/oauth/callback`

/** Map catalog plugin id → OAuth provider */
export const PLUGIN_OAUTH_PROVIDERS: Record<string, PluginOAuthProvider> = {
  'github-connector': {
    clientKey: 'github',
    flow: 'device',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    deviceCodeUrl: 'https://github.com/login/device/code',
    scopes: ['repo', 'read:user', 'read:org'],
    docsUrl: 'https://github.com/settings/developers',
  },
  'notion-connector': {
    clientKey: 'notion',
    flow: 'code',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],
    tokenAuth: 'basic',
    extraAuthParams: { owner: 'user', response_type: 'code' },
    redirectPath: OAUTH_REDIRECT_URI,
    docsUrl: 'https://developers.notion.com/docs/authorization',
  },
  'calendar-connector': {
    clientKey: 'google',
    flow: 'code',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar'],
    usePkce: true,
    tokenAuth: 'body',
    extraAuthParams: {
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
    redirectPath: OAUTH_REDIRECT_URI,
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  'spreadsheets-connector': {
    clientKey: 'google',
    flow: 'code',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    usePkce: true,
    tokenAuth: 'body',
    extraAuthParams: {
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
    redirectPath: OAUTH_REDIRECT_URI,
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  'presentations-connector': {
    clientKey: 'google',
    flow: 'code',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/presentations'],
    usePkce: true,
    tokenAuth: 'body',
    extraAuthParams: {
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
    redirectPath: OAUTH_REDIRECT_URI,
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  'dropbox-connector': {
    clientKey: 'dropbox',
    flow: 'code',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scopes: [],
    usePkce: true,
    tokenAuth: 'body',
    extraAuthParams: { response_type: 'code', token_access_type: 'offline' },
    redirectPath: OAUTH_REDIRECT_URI,
    docsUrl: 'https://www.dropbox.com/developers/apps',
  },
  'linear-connector': {
    clientKey: 'linear',
    flow: 'code',
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: ['read', 'write'],
    usePkce: false,
    tokenAuth: 'body',
    extraAuthParams: { response_type: 'code', prompt: 'consent' },
    redirectPath: OAUTH_REDIRECT_URI,
    docsUrl: 'https://linear.app/settings/api',
  },
  'figma-connector': {
    // Figma primarily uses PAT; OAuth apps exist for multi-user products
    clientKey: 'figma',
    flow: 'code',
    authorizeUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://api.figma.com/v1/oauth/token',
    scopes: ['file_read'],
    usePkce: false,
    tokenAuth: 'body',
    extraAuthParams: { response_type: 'code', scope: 'file_read' },
    redirectPath: OAUTH_REDIRECT_URI,
    docsUrl: 'https://www.figma.com/developers/api#oauth2',
  },
}

export function oauthProviderForPlugin(pluginId: string): PluginOAuthProvider | null {
  return PLUGIN_OAUTH_PROVIDERS[pluginId] || null
}
