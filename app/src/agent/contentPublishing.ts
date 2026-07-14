export interface PublishSchedule {
  id: string
  contentItemId: string
  platform: string
  scheduledAt: string
  status: PublishScheduleStatus
  externalId?: string
  lastError?: string
}

export type PublishScheduleStatus = 'scheduled' | 'publishing' | 'published' | 'failed'

export interface CreatePublishScheduleInput {
  contentItemId: string
  platform: string
  scheduledAt: string
}

export type CreatePublishScheduleResult =
  | { ok: true; schedule: PublishSchedule }
  | {
      ok: false
      error: {
        code:
          | 'CONTENT_PLATFORM_ALREADY_SCHEDULED'
          | 'CONTENT_SCHEDULE_PERSISTENCE_FAILED'
        message: string
      }
    }

export type UpdatePublishScheduleResult =
  | { ok: true; schedule: PublishSchedule }
  | {
      ok: false
      error: {
        code: 'CONTENT_SCHEDULE_NOT_FOUND' | 'CONTENT_SCHEDULE_PERSISTENCE_FAILED'
        message: string
      }
    }

const DUPLICATE_PLATFORM_SCHEDULE_MESSAGE =
  '此 ContentItem 已在 24 小時內排程發布至此平台'
const SCHEDULE_PERSISTENCE_ERROR_MESSAGE =
  '排程資料無法保存，未建立發布排程'
const SCHEDULE_UPDATE_PERSISTENCE_ERROR_MESSAGE =
  '排程狀態無法保存，未確認發布結果'
const SCHEDULE_NOT_FOUND_MESSAGE = '找不到指定的內容發布排程'
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1_000
const DEFAULT_STORAGE_KEY = 'subagents.content-publish-schedules.v1'

export interface PublishScheduleStorage {
  read: () => unknown
  write: (schedules: PublishSchedule[]) => void
}

export interface PublishScheduleLedger {
  create: (
    input: CreatePublishScheduleInput,
    options: { id: string },
  ) => CreatePublishScheduleResult
  update: (
    id: string,
    patch: Pick<PublishSchedule, 'status' | 'externalId' | 'lastError'>,
  ) => UpdatePublishScheduleResult
  list: () => PublishSchedule[]
}

function isSameContentItemAndPlatform(
  schedule: PublishSchedule,
  input: CreatePublishScheduleInput,
): boolean {
  return (
    schedule.contentItemId.trim() === input.contentItemId.trim() &&
    schedule.platform.trim().toLowerCase() === input.platform.trim().toLowerCase()
  )
}

function isWithinTwentyFourHours(first: string, second: string): boolean {
  const firstMs = Date.parse(first)
  const secondMs = Date.parse(second)
  return (
    !Number.isNaN(firstMs) &&
    !Number.isNaN(secondMs) &&
    Math.abs(firstMs - secondMs) < TWENTY_FOUR_HOURS_MS
  )
}

function isPublishSchedule(value: unknown): value is PublishSchedule {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PublishSchedule>
  return (
    typeof candidate.id === 'string' &&
    Boolean(candidate.id.trim()) &&
    typeof candidate.contentItemId === 'string' &&
    Boolean(candidate.contentItemId.trim()) &&
    typeof candidate.platform === 'string' &&
    Boolean(candidate.platform.trim()) &&
    typeof candidate.scheduledAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.scheduledAt)) &&
    (candidate.status === undefined ||
      candidate.status === 'scheduled' ||
      candidate.status === 'publishing' ||
      candidate.status === 'published' ||
      candidate.status === 'failed')
  )
}

function normalizeStoredSchedules(value: unknown): PublishSchedule[] {
  return Array.isArray(value)
    ? value
        .filter(isPublishSchedule)
        .map((schedule) => ({ ...schedule, status: schedule.status || 'scheduled' }))
    : []
}

function persistenceFailureResult(): CreatePublishScheduleResult {
  return {
    ok: false,
    error: {
      code: 'CONTENT_SCHEDULE_PERSISTENCE_FAILED',
      message: SCHEDULE_PERSISTENCE_ERROR_MESSAGE,
    },
  }
}

function persistenceFailureUpdate(): UpdatePublishScheduleResult {
  return {
    ok: false,
    error: {
      code: 'CONTENT_SCHEDULE_PERSISTENCE_FAILED',
      message: SCHEDULE_UPDATE_PERSISTENCE_ERROR_MESSAGE,
    },
  }
}

/**
 * Public domain seam for scheduling a ContentItem publication.
 * The same ContentItem may not have two schedules on one platform less than
 * 24 hours apart.
 */
function createPublishSchedule(
  existingSchedules: PublishSchedule[],
  input: CreatePublishScheduleInput,
  options: { id: string },
): CreatePublishScheduleResult {
  const hasDuplicate = existingSchedules.some(
    (schedule) =>
      isSameContentItemAndPlatform(schedule, input) &&
      isWithinTwentyFourHours(schedule.scheduledAt, input.scheduledAt),
  )

  if (hasDuplicate) {
    return {
      ok: false,
      error: {
        code: 'CONTENT_PLATFORM_ALREADY_SCHEDULED',
        message: DUPLICATE_PLATFORM_SCHEDULE_MESSAGE,
      },
    }
  }

  return {
    ok: true,
    schedule: {
      id: options.id,
      contentItemId: input.contentItemId.trim(),
      platform: input.platform.trim(),
      scheduledAt: input.scheduledAt,
      status: 'scheduled',
    },
  }
}

function createLedger(
  initialSchedules: PublishSchedule[],
  onCommit?: (schedules: PublishSchedule[]) => void,
): PublishScheduleLedger {
  const schedules = [...initialSchedules]

  return {
    create: (input, options) => {
      const result = createPublishSchedule(schedules, input, options)
      if (!result.ok) return result

      const nextSchedules = [...schedules, result.schedule]
      try {
        onCommit?.(nextSchedules)
      } catch {
        return persistenceFailureResult()
      }
      schedules.push(result.schedule)
      return result
    },
    update: (id, patch) => {
      const index = schedules.findIndex((schedule) => schedule.id === id)
      if (index < 0) {
        return {
          ok: false,
          error: {
            code: 'CONTENT_SCHEDULE_NOT_FOUND',
            message: SCHEDULE_NOT_FOUND_MESSAGE,
          },
        }
      }
      const updated = { ...schedules[index], ...patch }
      const nextSchedules = schedules.map((schedule, itemIndex) =>
        itemIndex === index ? updated : schedule,
      )
      try {
        onCommit?.(nextSchedules)
      } catch {
        return persistenceFailureUpdate()
      }
      schedules[index] = updated
      return { ok: true, schedule: updated }
    },
    list: () => [...schedules],
  }
}

/**
 * Owns the schedule state used for duplicate checks. Hydrate it from the
 * durable schedule store once, then keep this ledger for every retrigger in
 * that scheduling session.
 */
export function createPublishScheduleLedger(
  initialSchedules: PublishSchedule[] = [],
): PublishScheduleLedger {
  return createLedger(initialSchedules)
}

/**
 * Hydrates once from storage and commits each accepted schedule before the
 * in-memory ledger advances, so a failed write cannot look like success.
 */
export function createPersistentPublishScheduleLedger(
  storage: PublishScheduleStorage,
): PublishScheduleLedger {
  let ledger: PublishScheduleLedger
  try {
    ledger = createLedger(normalizeStoredSchedules(storage.read()), (schedules) =>
      storage.write(schedules),
    )
  } catch {
    ledger = createLedger([])
  }

  return {
    create: (input, options) => {
      try {
        // Refresh immediately before the check so an older ledger cannot use
        // a stale empty snapshot after another owner has committed a schedule.
        ledger = createLedger(normalizeStoredSchedules(storage.read()), (schedules) =>
          storage.write(schedules),
        )
      } catch {
        return persistenceFailureResult()
      }
      return ledger.create(input, options)
    },
    update: (id, patch) => {
      try {
        ledger = createLedger(normalizeStoredSchedules(storage.read()), (schedules) =>
          storage.write(schedules),
        )
      } catch {
        return persistenceFailureUpdate()
      }
      return ledger.update(id, patch)
    },
    list: () => ledger.list(),
  }
}

/** Browser fallback used by the renderer when no Electron storage bridge exists. */
export function createLocalStoragePublishScheduleLedger(
  storageKey = DEFAULT_STORAGE_KEY,
): PublishScheduleLedger {
  if (typeof localStorage === 'undefined') return createPublishScheduleLedger()

  return createPersistentPublishScheduleLedger({
    read: () => {
      const raw = localStorage.getItem(storageKey)
      return raw ? JSON.parse(raw) : []
    },
    write: (schedules) => {
      localStorage.setItem(storageKey, JSON.stringify(schedules))
    },
  })
}
