/**
 * Cross-session recall — simplified FTS over archive + memory + skills
 * (Hermes uses SQLite FTS5; we use token scoring for portability.)
 */

import type { ArchiveRecord } from '../types'
import type { LlmSettings } from '../types'
import { chatCompletion, withRoleModel } from '../llm'
import { memoryStore } from './memory'
import { skillsStore } from './skills'
import type { SessionSearchHit } from './types'
import { scoreQueryText } from './textSimilarity'

function scoreText(query: string, text: string): number {
  return scoreQueryText(query, text)
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
    const failBoost = e.tags?.includes('failure') ? 4 : 0
    hits.push({
      id: e.id,
      source: 'memory',
      title: e.tags?.includes('failure') ? '失敗教訓' : '記憶條目',
      snippet: e.text.slice(0, 160),
      score: scoreText(query, `${e.text} ${(e.tags || []).join(' ')}`) + 1 + failBoost,
      timestamp: e.createdAt,
      tags: e.tags,
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

/**
 * Optional LLM layer over deterministic search. Token-scored hits remain the
 * source of truth; a failed/unconfigured model simply returns null and callers
 * continue rendering the original snippets.
 */
export async function summarizeSessionHits(
  hits: SessionSearchHit[],
  query: string,
  providedSettings?: LlmSettings,
): Promise<string | null> {
  const selected = hits.slice(0, 5)
  if (!query.trim() || !selected.length) return null

  let settings = providedSettings
  if (!settings) {
    try {
      const { useSettingsStore } = await import('../../store/settingsStore')
      settings = useSettingsStore.getState().settings
    } catch {
      return null
    }
  }
  if (
    !settings.enabled ||
    !settings.apiKey.trim() ||
    settings.sessionRecallEnabled === false
  ) {
    return null
  }

  const helper = withRoleModel(settings, 'Analyzer-1')
  if (!helper.model) return null
  const evidence = selected
    .map(
      (hit, index) =>
        `${index + 1}. [${hit.source}] ${hit.title}\n${hit.snippet.slice(0, 600)}`,
    )
    .join('\n\n')
  try {
    const result = await chatCompletion(
      helper,
      [
        {
          role: 'system',
          content:
            '你是跨會話記憶摘要助手。根據提供的搜尋命中，簡短說明它們和查詢的關聯；不可添加證據中沒有的事實。使用繁體中文，最多 3 句。',
        },
        {
          role: 'user',
          content: `查詢：${query.slice(0, 300)}\n\n搜尋命中：\n${evidence}`,
        },
      ],
      { temperature: 0.2, maxTokens: 360 },
    )
    return result.content.trim() || null
  } catch {
    return null
  }
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
