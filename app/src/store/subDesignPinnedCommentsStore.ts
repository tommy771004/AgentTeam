import { create } from 'zustand'
import type { SubDesignPinnedComment, SubDesignPinnedCommentAuditRecord } from '../agent/subdesign/pinnedComments.ts'
import { persistSubDesignMetadata, readSubDesignMetadata } from '../agent/subdesign/metadata.ts'

const STORAGE_KEY = 'subagents.subdesign.pinned-comments.v1'

function loadRecords(): SubDesignPinnedCommentAuditRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item === 'object').slice(0, 120)
  } catch {
    return []
  }
}

function persist(records: SubDesignPinnedCommentAuditRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 120)))
  } catch {
    /* localStorage is optional in browser preview. */
  }
}

interface SubDesignPinnedCommentsStore {
  records: SubDesignPinnedCommentAuditRecord[]
  /** 目前累積、尚未送出的 pins（以 artifactId 為鍵）。 */
  draftByArtifactId: Record<string, SubDesignPinnedComment[]>
  addDraft: (artifactId: string, pin: SubDesignPinnedComment) => void
  clearDrafts: (artifactId: string) => void
  recordSubmission: (
    record: Omit<SubDesignPinnedCommentAuditRecord, 'id' | 'createdAt'>,
    projectRoot: string,
  ) => Promise<{ record: SubDesignPinnedCommentAuditRecord; persisted: boolean }>
  hydrateCanonical: (projectRoot: string) => Promise<void>
  findByArtifactId: (artifactId: string) => SubDesignPinnedCommentAuditRecord[]
}

export const useSubDesignPinnedCommentsStore = create<SubDesignPinnedCommentsStore>((set, get) => ({
  records: loadRecords(),
  draftByArtifactId: {},

  addDraft: (artifactId, pin) => {
    const drafts = get().draftByArtifactId[artifactId] || []
    if (drafts.length >= 12) return
    set({ draftByArtifactId: { ...get().draftByArtifactId, [artifactId]: [...drafts, pin] } })
  },

  clearDrafts: (artifactId) => {
    const next = { ...get().draftByArtifactId }
    delete next[artifactId]
    set({ draftByArtifactId: next })
  },

  recordSubmission: async (record, projectRoot) => {
    const full: SubDesignPinnedCommentAuditRecord = {
      ...record,
      id: `pin_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    }
    const records = [full, ...get().records].slice(0, 120)
    set({ records })
    persist(records)
    const persisted = await persistSubDesignMetadata('pinned-comment', full, projectRoot)
    return { record: full, persisted }
  },

  hydrateCanonical: async (projectRoot) => {
    const metadata = await readSubDesignMetadata(projectRoot)
    if (!metadata) return
    const canonical = metadata.pinnedComments.filter((item): item is SubDesignPinnedCommentAuditRecord => {
      if (!item || typeof item !== 'object') return false
      const record = item as Partial<SubDesignPinnedCommentAuditRecord>
      return typeof record.id === 'string' && typeof record.artifactId === 'string' && Array.isArray(record.pins)
    })
    const byId = new Map([...canonical, ...get().records].map((record) => [record.id, record]))
    const records = [...byId.values()]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 120)
    set({ records })
    persist(records)
  },

  findByArtifactId: (artifactId) => get().records.filter((item) => item.artifactId === artifactId),
}))
