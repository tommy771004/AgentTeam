import { create } from 'zustand'
import type { SubDesignPinnedComment, SubDesignPinnedCommentAuditRecord } from '../agent/subdesign/pinnedComments.ts'
import { persistSubDesignMetadata } from '../agent/subdesign/metadata.ts'

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
  recordSubmission: (record: Omit<SubDesignPinnedCommentAuditRecord, 'id' | 'createdAt'>) => SubDesignPinnedCommentAuditRecord
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

  recordSubmission: (record) => {
    const full: SubDesignPinnedCommentAuditRecord = {
      ...record,
      id: `pin_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    }
    const records = [full, ...get().records].slice(0, 120)
    set({ records })
    persist(records)
    // Project-relative canonical 記錄；browser preview 無 API 時靜默略過。
    void persistSubDesignMetadata('pinned-comment', full)
    return full
  },

  findByArtifactId: (artifactId) => get().records.filter((item) => item.artifactId === artifactId),
}))
