/**
 * Persistent memory — inspired by Hermes MEMORY.md / USER.md
 */

import { v4 as uuid } from 'uuid'
import type { MemoryBundle, MemoryEntry } from './types'

const MAX_MEMORY_CHARS = 12_000
const MAX_USER_CHARS = 4_000

function now() {
  return new Date().toISOString()
}

export class MemoryStore {
  private userProfile = ''
  private memory = ''
  private entries: MemoryEntry[] = []

  getBundle(): MemoryBundle {
    return {
      userProfile: this.userProfile,
      memory: this.memory,
      entries: [...this.entries],
      updatedAt: now(),
    }
  }

  loadBundle(b: Partial<MemoryBundle> | null | undefined) {
    if (!b) return
    this.userProfile = (b.userProfile || '').slice(0, MAX_USER_CHARS)
    this.memory = (b.memory || '').slice(0, MAX_MEMORY_CHARS)
    this.entries = Array.isArray(b.entries) ? b.entries : []
  }

  setUserProfile(text: string) {
    this.userProfile = text.slice(0, MAX_USER_CHARS)
  }

  setMemoryDoc(text: string) {
    this.memory = text.slice(0, MAX_MEMORY_CHARS)
  }

  appendMemory(text: string, tags?: string[]): MemoryEntry {
    const entry: MemoryEntry = {
      id: uuid(),
      kind: 'memory',
      text: text.trim().slice(0, 2000),
      createdAt: now(),
      tags,
    }
    this.entries = [entry, ...this.entries].slice(0, 200)
    // Also append to markdown doc (Hermes-style)
    const line = `- [${entry.createdAt.slice(0, 10)}] ${entry.text}`
    this.memory = `${this.memory}\n${line}`.trim().slice(0, MAX_MEMORY_CHARS)
    return entry
  }

  search(query: string, limit = 8): MemoryEntry[] {
    const q = query.toLowerCase().trim()
    if (!q) return this.entries.slice(0, limit)
    const scored = this.entries
      .map((e) => {
        const hay = e.text.toLowerCase()
        let score = 0
        for (const w of q.split(/\s+/)) {
          if (w.length > 1 && hay.includes(w)) score += 1
        }
        return { e, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((x) => x.e)
  }

  deleteEntry(id: string) {
    this.entries = this.entries.filter((e) => e.id !== id)
  }

  clearEntries() {
    this.entries = []
  }

  clearAll() {
    this.userProfile = ''
    this.memory = ''
    this.entries = []
  }

  /** Volatile prompt block; objective adds the most relevant non-recent memories. */
  buildPromptBlock(enabled = true, objective?: string): string {
    if (!enabled) {
      return '## 持久記憶（Memory）\n（記憶已關閉，不帶入跨對話上下文。）'
    }
    const parts: string[] = ['## 持久記憶（Memory）']
    if (this.userProfile.trim()) {
      parts.push('### 使用者檔案 (USER)', this.userProfile.trim().slice(0, 1500))
    }
    if (this.memory.trim()) {
      parts.push('### 長期記憶 (MEMORY)', this.memory.trim().slice(0, 3000))
    }
    const recent = this.entries.slice(0, 5)
    if (recent.length) {
      parts.push(
        '### 近期條目',
        ...recent.map((e) => `- ${e.text.slice(0, 200)}`),
      )
    }
    if (objective?.trim()) {
      const recentIds = new Set(recent.map((entry) => entry.id))
      const related = this.search(objective, 3).filter((entry) => !recentIds.has(entry.id))
      if (related.length) {
        parts.push(
          '### 與本目標相關記憶',
          ...related.map((entry) => `- ${entry.text.slice(0, 200)}`),
        )
      }
      // P2: hard-surface failure lessons so the model avoids repeating mistakes
      const failureLessons = this.entries
        .filter(
          (entry) =>
            entry.tags?.includes('failure') &&
            !recentIds.has(entry.id) &&
            !related.some((r) => r.id === entry.id),
        )
        .slice(0, 3)
      // Prefer failures that share tokens with the objective
      const objLower = objective.toLowerCase()
      const scoredFailures = this.entries
        .filter((entry) => entry.tags?.includes('failure'))
        .map((entry) => {
          let score = 0
          const hay = entry.text.toLowerCase()
          for (const w of objLower.split(/\s+/)) {
            if (w.length > 1 && hay.includes(w)) score += 1
          }
          for (const m of objective.match(/[一-鿿]{2,}/g) || []) {
            if (entry.text.includes(m)) score += 2
          }
          return { entry, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((x) => x.entry)
      const lessons = scoredFailures.length ? scoredFailures : failureLessons
      if (lessons.length) {
        parts.push(
          '### 失敗教訓（同類 — 必須避開）',
          '下列為過去失敗記錄；執行前先讀，勿重蹈相同工具或策略錯誤。',
          ...lessons.map((entry) => `- ${entry.text.slice(0, 200)}`),
        )
      }
    }
    if (parts.length === 1) {
      parts.push('（尚無記憶。重要偏好請用 memory_append 寫入。）')
    }
    return parts.join('\n')
  }

  exportMarkdown(): { user: string; memory: string } {
    return {
      user: `# USER.md\n\n${this.userProfile || '（空）'}\n`,
      memory: `# MEMORY.md\n\n${this.memory || '（空）'}\n`,
    }
  }
}

export const memoryStore = new MemoryStore()
