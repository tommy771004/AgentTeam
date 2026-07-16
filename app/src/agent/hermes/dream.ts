/**
 * Dream consolidation — grok-build `/dream` + auto-dream gates 的移植。
 *
 * 把零散的機器寫入記憶(auto/flush)整併去重,降低雜訊、提升檢索品質。
 * Gate 對齊 grok `[memory.dream]`:距上次 ≥ 4 小時且新累積 ≥ 3 筆
 * 機器記憶才跑。與 skill curator 相同的 idle 排程模式 —— 不是第二個
 * cron engine,只在 agent 閒置時執行;只動 auto/flush 條目,
 * 使用者手寫記憶永不整併。
 */

import type { LlmSettings } from '../types'
import { chatCompletion, withRoleModel } from '../llm'
import { learningLoop } from './learning'
import { memoryStore } from './memory'
import { textSimilarity } from './textSimilarity'
import type { MemoryEntry } from './types'

export const DREAM_MIN_HOURS = 4
export const DREAM_MIN_NEW_ENTRIES = 3
/** 近似 grok semantic_dedup_threshold(cosine 0.92)的 token 相似度門檻 */
export const DREAM_DUP_THRESHOLD = 0.85
/** 機器記憶超過此數量時,把最舊一批交給模型整併成主題摘要 */
const MERGE_WHEN_OVER = 24
const MERGE_BATCH = 12

const STORAGE_KEY = 'subagents.hermes.dream.v1'
const IDLE_DELAY_MS = 20_000

let idleTimer: ReturnType<typeof setTimeout> | undefined
let dreamRunning = false

type DreamState = { lastRunAt?: string }

export type DreamResult = {
  ran: boolean
  reason?: string
  deduped: string[]
  merged: number
  usedModel: boolean
}

function readState(): DreamState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DreamState) : {}
  } catch {
    return {}
  }
}

function writeState(state: DreamState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* browser quota / test environment */
  }
}

function machineEntries(): MemoryEntry[] {
  return memoryStore
    .getBundle()
    .entries.filter(
      (e) => (e.tags || []).some((t) => t === 'auto' || t === 'flush') && !(e.tags || []).includes('dream'),
    )
}

/** Pure gate(smoke 鏡射):時間 + 新條目數雙門檻。 */
export function dreamDue(
  nowMs: number,
  lastRunAtIso: string | undefined,
  newEntriesSinceLastRun: number,
): boolean {
  const last = Date.parse(lastRunAtIso || '')
  const hoursOk = !Number.isFinite(last) || nowMs - last >= DREAM_MIN_HOURS * 3_600_000
  return hoursOk && newEntriesSinceLastRun >= DREAM_MIN_NEW_ENTRIES
}

function newEntriesSince(entries: MemoryEntry[], lastRunAtIso: string | undefined): number {
  const last = Date.parse(lastRunAtIso || '')
  if (!Number.isFinite(last)) return entries.length
  return entries.filter((e) => (Date.parse(e.createdAt || '') || 0) > last).length
}

/** 去重:相似 ≥ 門檻的機器記憶,保留最舊(canonical),刪除較新的重複。 */
export function heuristicDedupeIds(entries: MemoryEntry[]): string[] {
  const byOldest = [...entries].sort(
    (a, b) => (Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0),
  )
  const duplicates: string[] = []
  for (let i = 0; i < byOldest.length; i += 1) {
    if (duplicates.includes(byOldest[i].id)) continue
    for (let j = i + 1; j < byOldest.length; j += 1) {
      if (duplicates.includes(byOldest[j].id)) continue
      if (textSimilarity(byOldest[i].text, byOldest[j].text) >= DREAM_DUP_THRESHOLD) {
        duplicates.push(byOldest[j].id)
      }
    }
  }
  return duplicates
}

async function mergeOldestWithModel(
  settings: LlmSettings,
  entries: MemoryEntry[],
): Promise<{ merged: number; usedModel: boolean }> {
  if (entries.length <= MERGE_WHEN_OVER) return { merged: 0, usedModel: false }
  const helperSettings = withRoleModel(settings, 'Analyzer-1')
  if (!settings.enabled || !helperSettings.model || !helperSettings.apiKey.trim()) {
    return { merged: 0, usedModel: false }
  }
  const batch = [...entries]
    .sort((a, b) => (Date.parse(a.createdAt || '') || 0) - (Date.parse(b.createdAt || '') || 0))
    .slice(0, MERGE_BATCH)
  const blob = batch.map((e) => `- [${(e.createdAt || '').slice(0, 10)}] ${e.text}`).join('\n')
  const r = await chatCompletion(
    helperSettings,
    [
      {
        role: 'system',
        content:
          '你是記憶整併器(dream consolidation)。把零散的自動記憶合併成一段去重、按主題組織的精煉摘要(Markdown 條列,≤ 800 字)。保留具體事實與教訓,刪除重複與流水帳。只輸出摘要本身。',
      },
      { role: 'user', content: blob },
    ],
    { temperature: 0.2, maxTokens: 700 },
  )
  const summary = r.content.trim()
  if (summary.length < 40) return { merged: 0, usedModel: true }
  memoryStore.appendMemory(`記憶整併（dream）：${summary.slice(0, 1800)}`, ['auto', 'dream'])
  for (const e of batch) memoryStore.deleteEntry(e.id)
  return { merged: batch.length, usedModel: true }
}

/** 跑一次整併。`force` 供手動觸發/驗證。 */
export async function runDreamConsolidation(
  settings: LlmSettings,
  opts?: { force?: boolean },
): Promise<DreamResult> {
  if (dreamRunning) {
    return { ran: false, reason: 'already-running', deduped: [], merged: 0, usedModel: false }
  }
  if (settings.memoryEnabled === false || settings.memoryWriteEnabled === false) {
    return { ran: false, reason: 'memory-disabled', deduped: [], merged: 0, usedModel: false }
  }
  const entries = machineEntries()
  const state = readState()
  if (!opts?.force && !dreamDue(Date.now(), state.lastRunAt, newEntriesSince(entries, state.lastRunAt))) {
    return { ran: false, reason: 'gates-not-met', deduped: [], merged: 0, usedModel: false }
  }

  dreamRunning = true
  writeState({ lastRunAt: new Date().toISOString() })
  try {
    const dupIds = heuristicDedupeIds(entries)
    for (const id of dupIds) memoryStore.deleteEntry(id)

    let merged = 0
    let usedModel = false
    try {
      const m = await mergeOldestWithModel(settings, machineEntries())
      merged = m.merged
      usedModel = m.usedModel
    } catch {
      /* 模型整併失敗不影響已完成的去重 */
    }

    if (dupIds.length || merged) {
      try {
        const { useLearningStore } = await import('../../store/learningStore')
        useLearningStore.getState().refresh()
        await useLearningStore.getState().persist()
      } catch {
        /* persistence is best effort */
      }
      learningLoop.onDreamConsolidation({ deduped: dupIds.length, merged })
    }
    return { ran: true, deduped: dupIds, merged, usedModel }
  } finally {
    dreamRunning = false
  }
}

/** Idle 排程(同 skill curator 模式)。 */
export function scheduleDreamConsolidation(
  settings: LlmSettings,
  idleDelayMs = IDLE_DELAY_MS,
) {
  if (idleTimer) clearTimeout(idleTimer)
  const entries = machineEntries()
  if (!dreamDue(Date.now(), readState().lastRunAt, newEntriesSince(entries, readState().lastRunAt))) {
    return
  }
  idleTimer = setTimeout(() => {
    idleTimer = undefined
    void (async () => {
      const [{ useAgentStore }, { queueLength }] = await Promise.all([
        import('../../store/agentStore'),
        import('../runQueue'),
      ])
      if (!useAgentStore.getState().canStartRun().allowed || queueLength() > 0) return
      await runDreamConsolidation(settings)
    })()
  }, Math.max(0, idleDelayMs))
}
