import { create } from 'zustand'
import type { YouTubePrivacyStatus } from '../agent/contentPublishPlatforms.ts'

export interface ContentItem {
  id: string
  title: string
  body: string
  mediaUrl?: string
  mediaPath?: string
  mediaMimeType?: string
  targetId?: string
  privacyStatus?: YouTubePrivacyStatus
  createdAt: string
  updatedAt: string
}

export type CreateContentItemResult =
  | { ok: true; item: ContentItem }
  | {
      ok: false
      error: {
        code: 'CONTENT_ITEM_ALREADY_EXISTS' | 'CONTENT_ITEM_INVALID'
        message: string
      }
    }

interface ContentItemStore {
  items: ContentItem[]
  createItem: (input: {
    id: string
    title: string
    body: string
    mediaUrl?: string
    mediaPath?: string
    mediaMimeType?: string
    targetId?: string
    privacyStatus?: YouTubePrivacyStatus
  }) => CreateContentItemResult
  reload: () => void
}

const STORAGE_KEY = 'subagents.content-items.v1'

function isContentItem(value: unknown): value is ContentItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ContentItem>
  return (
    typeof item.id === 'string' && Boolean(item.id.trim()) &&
    typeof item.title === 'string' && Boolean(item.title.trim()) &&
    typeof item.body === 'string' &&
    (item.mediaUrl === undefined || typeof item.mediaUrl === 'string') &&
    (item.mediaPath === undefined || typeof item.mediaPath === 'string') &&
    (item.mediaMimeType === undefined || typeof item.mediaMimeType === 'string') &&
    (item.targetId === undefined || typeof item.targetId === 'string') &&
    (item.privacyStatus === undefined || item.privacyStatus === 'private' || item.privacyStatus === 'public' || item.privacyStatus === 'unlisted') &&
    typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt)) &&
    typeof item.updatedAt === 'string' && !Number.isNaN(Date.parse(item.updatedAt))
  )
}

function loadItems(): ContentItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isContentItem) : []
  } catch {
    return []
  }
}

function persistItems(items: ContentItem[]) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export const useContentItemStore = create<ContentItemStore>((set, get) => ({
  items: loadItems(),

  createItem: (input) => {
    const id = input.id.trim()
    const title = input.title.trim()
    if (!id || !title) {
      return {
        ok: false,
        error: {
          code: 'CONTENT_ITEM_INVALID',
          message: 'ContentItem ID 與標題不可為空白',
        },
      }
    }
    if (get().items.some((item) => item.id === id)) {
      return {
        ok: false,
        error: {
          code: 'CONTENT_ITEM_ALREADY_EXISTS',
          message: '此 ContentItem ID 已存在，請勿重複建立',
        },
      }
    }

    const now = new Date().toISOString()
    const item: ContentItem = {
      id,
      title,
      body: input.body.trim(),
      mediaUrl: input.mediaUrl?.trim() || undefined,
      mediaPath: input.mediaPath?.trim() || undefined,
      mediaMimeType: input.mediaMimeType?.trim() || undefined,
      targetId: input.targetId?.trim() || undefined,
      privacyStatus: input.privacyStatus,
      createdAt: now,
      updatedAt: now,
    }
    const items = [item, ...get().items]
    try {
      persistItems(items)
    } catch {
      return {
        ok: false,
        error: {
          code: 'CONTENT_ITEM_INVALID',
          message: 'ContentItem 無法保存，未建立內容',
        },
      }
    }
    set({ items })
    return { ok: true, item }
  },

  reload: () => set({ items: loadItems() }),
}))
