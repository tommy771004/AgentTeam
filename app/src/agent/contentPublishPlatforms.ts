export type ContentPublishPlatform =
  | 'instagram'
  | 'linkedin'
  | 'x'
  | 'facebook'
  | 'youtube'

export type ContentPublishMediaKind = 'image' | 'video'
export type YouTubePrivacyStatus = 'private' | 'public' | 'unlisted'

export interface ContentPublishProviderSpec {
  id: ContentPublishPlatform
  label: string
  scopes: string[]
  requiresMedia: boolean
  mediaKind?: ContentPublishMediaKind
  description: string
  docsUrl: string
}

export interface ContentPublishConnectionStatus {
  platform: ContentPublishPlatform
  label: string
  connected: boolean
  expiresAt?: number
  hasRefreshToken: boolean
  encrypted: boolean
  accountLabel?: string
  accountId?: string
  error?: string
}

export interface ContentPublishContent {
  contentItemId: string
  title: string
  body: string
  platform: ContentPublishPlatform
  scheduledAt: string
  mediaUrl?: string
  mediaPath?: string
  mediaMimeType?: string
  targetId?: string
  privacyStatus?: YouTubePrivacyStatus
}

export const CONTENT_PUBLISH_PROVIDERS: readonly ContentPublishProviderSpec[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    requiresMedia: true,
    mediaKind: 'image',
    description: 'Instagram Business/Creator image publishing via a public media URL.',
    docsUrl:
      'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    scopes: ['openid', 'profile', 'w_member_social'],
    requiresMedia: false,
    description: 'LinkedIn member text posts via the REST Posts API.',
    docsUrl:
      'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api',
  },
  {
    id: 'x',
    label: 'X',
    scopes: ['tweet.read', 'users.read', 'tweet.write', 'offline.access'],
    requiresMedia: false,
    description: 'X API v2 posts using OAuth 2.0 user context.',
    docsUrl: 'https://developer.x.com/en/docs/x-api/posts/create-post',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    requiresMedia: false,
    description: 'Facebook Page text posts using a Page access token.',
    docsUrl:
      'https://developers.facebook.com/docs/pages-api/posts',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    scopes: ['https://www.googleapis.com/auth/youtube.upload'],
    requiresMedia: true,
    mediaKind: 'video',
    description: 'YouTube video upload through the resumable Data API.',
    docsUrl: 'https://developers.google.com/youtube/v3/docs/videos/insert',
  },
]

export function contentPublishProvider(
  platform: string,
): ContentPublishProviderSpec | undefined {
  return CONTENT_PUBLISH_PROVIDERS.find((item) => item.id === platform.trim().toLowerCase())
}

export function composePublishText(title: string, body: string): string {
  return [title.trim(), body.trim()].filter(Boolean).join('\n\n').trim()
}
