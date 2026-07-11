/**
 * Cross-session recall — simplified FTS over archive + memory + skills
 * (Hermes uses SQLite FTS5; we use token scoring for portability.)
 */

import type { ArchiveRecord } from '../types'
import { memoryStore } from './memory'
import { skillsStore } from './skills'
import type { SessionSearchHit } from './types'

function scoreText(query: string, text: string): number {
  const q = query.toLowerCase().trim()
  if (!q) return 0
  const hay = text.toLowerCase()
  let score = 0
  for (const w of q.split(/\s+/)) {
    if (w.length < 2) continue
    if (hay.includes(w)) score += w.length > 3 ? 2 : 1
  }
  if (hay.includes(q)) score += 5
  return score
}

function snippet(text: string, query: string, len = 160): string {
  const lower = text.toLowerCase()
  const q = query.toLowerCase().split(/\s+/).find((w) => w.length > 2) || ''
  const idx = q ? lower.indexOf(q) : 0
  const start = Math.max(0, (idx >= 0 ? idx : 0) - 40)
  return (start > 0 ? '…' : '') + text.slice(start, start + len).replace(/\s+/g, ' ')
}

export function searchSessions(
  query: string,
  archive: ArchiveRecord[],
  limit = 20,
): SessionSearchHit[] {
  const hits: SessionSearchHit[] = []

  for (const a of archive) {
    const blob = `${a.objective}\n${a.result || ''}\n${a.logs.map((l) => l.message).join('\n')}`
    const sc = scoreText(query, blob)
    if (sc > 0) {
      hits.push({
        id: a.id,
        source: 'archive',
        title: a.objective.slice(0, 80) || a.id,
        snippet: snippet(blob, query),
        score: sc,
        timestamp: a.timestamp,
      })
    }
  }

  for (const e of memoryStore.search(query, 10)) {
    hits.push({
      id: e.id,
      source: 'memory',
      title: '記憶條目',
      snippet: e.text.slice(0, 160),
      score: scoreText(query, e.text) + 1,
      timestamp: e.createdAt,
    })
  }

  for (const s of skillsStore.list()) {
    const blob = `${s.meta.name}\n${s.meta.description}\n${s.body}`
    const sc = scoreText(query, blob)
    if (sc > 0) {
      hits.push({
        id: s.meta.name,
        source: 'skill',
        title: `技能：${s.meta.name}`,
        snippet: snippet(blob, query),
        score: sc,
      })
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Compress long step outputs (Hermes context compressor lite) */
export function compressStepOutputs(outputs: string[], maxChars = 6000): string {
  const joined = outputs.join('\n---\n')
  if (joined.length <= maxChars) return joined
  // Keep head + tail
  const head = outputs.slice(0, 2).join('\n---\n')
  const tail = outputs.slice(-2).join('\n---\n')
  const midCount = Math.max(0, outputs.length - 4)
  return [
    head,
    `\n…[已壓縮 ${midCount} 段中間步驟輸出]…\n`,
    tail,
  ]
    .join('\n')
    .slice(0, maxChars)
}
