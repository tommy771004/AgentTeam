/**
 * Persistent memory — inspired by Hermes MEMORY.md / USER.md
 */

import { v4 as uuid } from 'uuid'
import type { MemoryBundle, MemoryEntry } from './types'
import { scoreQueryText } from './textSimilarity.ts'

const MAX_MEMORY_CHARS = 12_000
const MAX_USER_CHARS = 4_000

/**
 * G6(grok memory 語意):機器寫入的記憶(auto/flush)隨時間衰減,
 * 讓近期經驗優先;使用者手寫與 curated 記憶不衰減。
 * 舊的機器記憶在檢索結果附 staleness 提示,提醒先驗證再信。
 */
export const MEMORY_DECAY_HALF_LIFE_DAYS = 7
export const MEMORY_STALE_AFTER_DAYS = 14
const DECAYING_TAGS = ['auto', 'flush']
const DAY_MS = 86_400_000

function isDecayingEntry(entry: Pick<MemoryEntry, 'tags'>): boolean {
  return (entry.tags || []).some((t) => DECAYING_TAGS.includes(t))
}

export function memoryDecayFactor(
  entry: Pick<MemoryEntry, 'createdAt' | 'tags'>,
  nowMs = Date.now(),
): number {
  if (!isDecayingEntry(entry)) return 1
  const created = Date.parse(entry.createdAt || '')
  if (!Number.isFinite(created)) return 1
  const ageMs = nowMs - created
  if (ageMs <= 0) return 1
  return 0.5 ** (ageMs / (MEMORY_DECAY_HALF_LIFE_DAYS * DAY_MS))
}

export function memoryStalenessNote(
  entry: Pick<MemoryEntry, 'createdAt' | 'tags'>,
  nowMs = Date.now(),
): string {
  if (!isDecayingEntry(entry)) return ''
  const created = Date.parse(entry.createdAt || '')
  if (!Number.isFinite(created)) return ''
  const days = Math.floor((nowMs - created) / DAY_MS)
  if (days < MEMORY_STALE_AFTER_DAYS) return ''
  return `（${days} 天前的自動記憶，使用前請先驗證現況）`
}

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
    const q = query.trim()
    if (!q) return this.entries.slice(0, limit)
    const scored = this.entries
      .map((e) => {
        // ASCII tokens + CJK bigrams; tags boost tool:/strategy: hits for packet recall
        let score = scoreQueryText(q, e.text)
        for (const tag of e.tags || []) {
          if (scoreQueryText(q, tag) > 0) score += 1.5
          // Explicit tool/strategy tags from failure lessons
          if (tag.startsWith('tool:') && q.toLowerCase().includes(tag.slice(5).toLowerCase())) {
            score += 3
          }
          if (tag.startsWith('strategy:') && q.toLowerCase().includes(tag.slice(9).toLowerCase())) {
            score += 2
          }
        }
        // temporal decay:auto/flush 記憶 half-life 7 天;手寫/curated 不衰減
        score *= memoryDecayFactor(e)
        return { e, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((x) => x.e)
  }

  /**
   * Compact failure-lesson block for ContextPacket (tool/strategy tags preserved).
   */
  buildFailureLessonsBlock(objective?: string, limit = 3): string {
    const failures = this.entries.filter((entry) => entry.tags?.includes('failure'))
    if (!failures.length) return ''
    let ranked = failures
    if (objective?.trim()) {
      ranked = failures
        .map((entry) => ({
          entry,
          score: scoreQueryText(objective, `${entry.text} ${(entry.tags || []).join(' ')}`),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.entry)
      if (!ranked.length) ranked = failures.slice(0, limit)
    }
    return ranked
      .slice(0, limit)
      .map((entry) => {
        const tags = (entry.tags || [])
          .filter((t) => t.startsWith('tool:') || t.startsWith('strategy:'))
          .join(' ')
        return `- ${entry.text.slice(0, 220)}${tags ? ` 〔${tags}〕` : ''}`
      })
      .join('\n')
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
          ...related.map(
            (entry) => `- ${entry.text.slice(0, 200)}${memoryStalenessNote(entry)}`,
          ),
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
      // Prefer failures that share ASCII/CJK tokens + tool/strategy tags
      const scoredFailures = this.entries
        .filter((entry) => entry.tags?.includes('failure'))
        .map((entry) => ({
          entry,
          score: scoreQueryText(objective, `${entry.text} ${(entry.tags || []).join(' ')}`),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((x) => x.entry)
      const lessons = scoredFailures.length ? scoredFailures : failureLessons
      if (lessons.length) {
        parts.push(
          '### 失敗教訓（同類 — 必須避開）',
          '下列為過去失敗記錄；執行前先讀，勿重蹈相同工具或策略錯誤。',
          ...lessons.map((entry) => {
            const tags = (entry.tags || [])
              .filter((t) => t.startsWith('tool:') || t.startsWith('strategy:'))
              .join(' ')
            return `- ${entry.text.slice(0, 200)}${tags ? ` 〔${tags}〕` : ''}`
          }),
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
