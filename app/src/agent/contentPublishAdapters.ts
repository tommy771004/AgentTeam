import type { PublishSchedule } from './contentPublishing.ts'
import type { YouTubePrivacyStatus } from './contentPublishPlatforms.ts'

export interface ContentPublishPayload {
  contentItemId: string
  title: string
  body: string
  platform: string
  scheduledAt: string
  mediaUrl?: string
  mediaPath?: string
  mediaMimeType?: string
  targetId?: string
  privacyStatus?: YouTubePrivacyStatus
}

export type PublishAdapterResult =
  | { ok: true; status: 'published'; externalId?: string }
  | {
      ok: false
      status: 'not-published'
      code:
        | 'PLATFORM_ADAPTER_UNAVAILABLE'
        | 'PLATFORM_PUBLISH_FAILED'
        | 'PLATFORM_AUTH_REQUIRED'
        | 'PLATFORM_CONFIG_REQUIRED'
        | 'PLATFORM_MEDIA_REQUIRED'
        | 'PLATFORM_API_FAILED'
      message: string
    }

export interface ContentPublishAdapter {
  platform: string
  publish: (payload: ContentPublishPayload) => Promise<PublishAdapterResult>
}

export interface ContentPublishAdapterRegistry {
  platforms: () => string[]
  publish: (
    schedule: PublishSchedule,
    content: Pick<
      ContentPublishPayload,
      | 'title'
      | 'body'
      | 'mediaUrl'
      | 'mediaPath'
      | 'mediaMimeType'
      | 'targetId'
      | 'privacyStatus'
    >,
  ) => Promise<PublishAdapterResult>
}

const ADAPTER_UNAVAILABLE_MESSAGE = '尚未設定此平台的發布 adapter，排程未發布'
const ADAPTER_FAILED_MESSAGE = '平台發布 adapter 執行失敗，內容未發布'

function normalizePlatform(platform: string) {
  return platform.trim().toLowerCase()
}

/**
 * External platform boundary. A schedule being accepted never implies that
 * the platform publish succeeded; only an adapter can produce `published`.
 */
export function createContentPublishAdapterRegistry(
  adapters: readonly ContentPublishAdapter[] = [],
): ContentPublishAdapterRegistry {
  const byPlatform = new Map<string, ContentPublishAdapter>()
  for (const adapter of adapters) {
    const platform = normalizePlatform(adapter.platform)
    if (platform && !byPlatform.has(platform)) byPlatform.set(platform, adapter)
  }

  return {
    platforms: () => [...byPlatform.keys()],
    publish: async (schedule, content) => {
      const adapter = byPlatform.get(normalizePlatform(schedule.platform))
      if (!adapter) {
        return {
          ok: false,
          status: 'not-published',
          code: 'PLATFORM_ADAPTER_UNAVAILABLE',
          message: ADAPTER_UNAVAILABLE_MESSAGE,
        }
      }

      try {
        return await adapter.publish({
          contentItemId: schedule.contentItemId,
          title: content.title,
          body: content.body,
          platform: normalizePlatform(schedule.platform),
          scheduledAt: schedule.scheduledAt,
          mediaUrl: content.mediaUrl,
          mediaPath: content.mediaPath,
          mediaMimeType: content.mediaMimeType,
          targetId: content.targetId,
          privacyStatus: content.privacyStatus,
        })
      } catch {
        return {
          ok: false,
          status: 'not-published',
          code: 'PLATFORM_PUBLISH_FAILED',
          message: ADAPTER_FAILED_MESSAGE,
        }
      }
    },
  }
}

export const defaultContentPublishAdapterRegistry =
  createContentPublishAdapterRegistry()
