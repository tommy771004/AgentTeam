/**
 * Compaction checkpoint — 壓縮前 transcript 快照(Grok Build
 * `compaction_checkpoints/` 的輕量版)。
 *
 * 每個 runId 只保留最新一份;全域 LRU 上限 5 個 run。
 * 儲存走 localStorage(瀏覽器/Electron renderer 皆可用),單份超過
 * 大小上限時降級為「只留摘要 + 訊息數」,絕不讓 quota 錯誤打斷 run。
 */

import { isElectronPiProduction } from './piProduction'

export interface CompactionCheckpoint {
  runId: string
  at: string
  summary: string
  messageCount: number
  /** 超過大小上限時為 undefined(僅保留摘要) */
  messages?: unknown[]
  truncated: boolean
}

const KEY_PREFIX = 'subagents.compaction.checkpoint.'
const INDEX_KEY = 'subagents.compaction.checkpoint.index'
const MAX_RUNS = 5
const MAX_BYTES = 300_000

function storage(): Storage | null {
  // Pi SessionManager owns transcript history and compaction in Electron.
  // Renderer checkpoints remain available to browser-only compatibility runs.
  if (isElectronPiProduction()) return null
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* SSR / test */
  }
  return null
}

function readIndex(s: Storage): string[] {
  try {
    const raw = s.getItem(INDEX_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeIndex(s: Storage, ids: string[]) {
  try {
    s.setItem(INDEX_KEY, JSON.stringify(ids.slice(-MAX_RUNS)))
  } catch {
    /* non-fatal */
  }
}

export function saveCompactionCheckpoint(
  runId: string,
  data: { summary: string; messages: unknown[] },
): boolean {
  const s = storage()
  if (!s || !runId) return false
  const base: CompactionCheckpoint = {
    runId,
    at: new Date().toISOString(),
    summary: data.summary.slice(0, 8_000),
    messageCount: data.messages.length,
    messages: data.messages,
    truncated: false,
  }
  try {
    let payload = JSON.stringify(base)
    if (payload.length > MAX_BYTES) {
      payload = JSON.stringify({ ...base, messages: undefined, truncated: true })
    }
    s.setItem(KEY_PREFIX + runId, payload)
    // LRU:移到最後,擠掉最舊
    const ids = readIndex(s).filter((id) => id !== runId)
    ids.push(runId)
    for (const evicted of ids.slice(0, Math.max(0, ids.length - MAX_RUNS))) {
      try {
        s.removeItem(KEY_PREFIX + evicted)
      } catch {
        /* ignore */
      }
    }
    writeIndex(s, ids)
    return true
  } catch {
    // quota 滿:退一步只存摘要
    try {
      s.setItem(
        KEY_PREFIX + runId,
        JSON.stringify({ ...base, messages: undefined, truncated: true }),
      )
      return true
    } catch {
      return false
    }
  }
}

export function loadCompactionCheckpoint(runId: string): CompactionCheckpoint | null {
  const s = storage()
  if (!s || !runId) return null
  try {
    const raw = s.getItem(KEY_PREFIX + runId)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CompactionCheckpoint
    return parsed && parsed.runId === runId ? parsed : null
  } catch {
    return null
  }
}

export function listCompactionCheckpoints(): string[] {
  const s = storage()
  if (!s) return []
  return readIndex(s)
}
