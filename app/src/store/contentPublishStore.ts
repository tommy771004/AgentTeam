import { create } from 'zustand'
import {
  defaultContentPublishAdapterRegistry,
  type PublishAdapterResult,
} from '../agent/contentPublishAdapters.ts'
import type { YouTubePrivacyStatus } from '../agent/contentPublishPlatforms.ts'
import {
  createLocalStoragePublishScheduleLedger,
  type CreatePublishScheduleInput,
  type CreatePublishScheduleResult,
  type PublishSchedule,
  type PublishScheduleLedger,
} from '../agent/contentPublishing.ts'

export type PublishScheduleExecutionResult = PublishAdapterResult | {
  ok: false
  status: 'not-published'
  code: 'CONTENT_SCHEDULE_NOT_FOUND' | 'CONTENT_SCHEDULE_PERSISTENCE_FAILED'
  message: string
}

interface ContentPublishStore {
  schedules: PublishSchedule[]
  createSchedule: (
    input: CreatePublishScheduleInput,
    options: { id: string },
  ) => CreatePublishScheduleResult
  publishSchedule: (
    scheduleId: string,
    content: {
      title: string
      body: string
      mediaUrl?: string
      mediaPath?: string
      mediaMimeType?: string
      targetId?: string
      privacyStatus?: YouTubePrivacyStatus
    },
  ) => Promise<PublishScheduleExecutionResult>
  reload: () => void
}

let ledger: PublishScheduleLedger = createLocalStoragePublishScheduleLedger()

export const useContentPublishStore = create<ContentPublishStore>((set) => ({
  schedules: ledger.list(),

  createSchedule: (input, options) => {
    const result = ledger.create(input, options)
    if (result.ok) set({ schedules: ledger.list() })
    return result
  },

  publishSchedule: async (scheduleId, content) => {
    const schedule = ledger.list().find((item) => item.id === scheduleId)
    if (!schedule) {
      return {
        ok: false,
        status: 'not-published',
        code: 'CONTENT_SCHEDULE_NOT_FOUND',
        message: '找不到指定的內容發布排程',
      }
    }

    const publishing = ledger.update(scheduleId, {
      status: 'publishing',
      externalId: undefined,
      lastError: undefined,
    })
    if (!publishing.ok) {
      return {
        ok: false,
        status: 'not-published',
        code: 'CONTENT_SCHEDULE_PERSISTENCE_FAILED',
        message: publishing.error.message,
      }
    }
    set({ schedules: ledger.list() })

    const electronPublisher =
      typeof window !== 'undefined' ? window.subagents?.contentPublishing?.publish : undefined
    const result = electronPublisher
      ? await electronPublisher({
          scheduleId,
          contentItemId: schedule.contentItemId,
          platform: schedule.platform,
          scheduledAt: schedule.scheduledAt,
          ...content,
        })
      : await defaultContentPublishAdapterRegistry.publish(schedule, content)
    const finalState = result.ok
      ? { status: 'published' as const, externalId: result.externalId, lastError: undefined }
      : { status: 'failed' as const, externalId: undefined, lastError: result.message }
    const finalized = ledger.update(scheduleId, finalState)
    if (!finalized.ok) {
      return {
        ok: false,
        status: 'not-published',
        code: 'CONTENT_SCHEDULE_PERSISTENCE_FAILED',
        message: finalized.error.message,
      }
    }
    set({ schedules: ledger.list() })
    return result
  },

  reload: () => {
    ledger = createLocalStoragePublishScheduleLedger()
    set({ schedules: ledger.list() })
  },
}))
