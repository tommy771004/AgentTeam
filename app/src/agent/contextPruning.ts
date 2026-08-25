/**
 * Tool-result pruning — Grok Build `[compaction.pruning]` 風格三層截斷。
 *
 * 只截 tool 訊息的 content,不增刪訊息,assistant.tool_calls → tool.tool_call_id
 * 鏈完整保留(compaction 的 alignKeepStart 防線不受影響)。三層:
 *
 * 1. 最近 `keepLastNRounds` 輪的 tool result 一律不動
 * 2. 更舊且超過 `softTrimThresholdChars` 的:保留頭尾、截中間
 * 3. 超過 `hardClearAgeRounds` 輪的:整段換 placeholder(需要時重新呼叫)
 *
 * 這是最便宜的省 context 手段,發生在 LLM 摘要式 compaction 之前。
 * 純邏輯;smoke-caps.mjs 鏡射驗證。
 */

export interface PruningConfig {
  enabled: boolean
  /** 最近 N 輪(assistant tool_calls 為一輪)的 tool result 永不截 */
  keepLastNRounds: number
  /** 舊 tool result 超過此 chars 才 soft-trim */
  softTrimThresholdChars: number
  softTrimHeadChars: number
  softTrimTailChars: number
  /** 距今超過 N 輪的 tool result 直接換 placeholder */
  hardClearAgeRounds: number
}

/** 預設值對齊 grok-build [compaction.pruning]。 */
export const DEFAULT_PRUNING_CONFIG: PruningConfig = {
  enabled: true,
  keepLastNRounds: 3,
  softTrimThresholdChars: 4_000,
  softTrimHeadChars: 1_500,
  softTrimTailChars: 1_500,
  hardClearAgeRounds: 10,
}

/** compaction CompactableMessage / llm ChatMessageExt 相容的最小形狀。 */
export interface PrunableMessage {
  role: string
  /** 多模態 content 只會原樣通過:pruning 只截 `typeof content === 'string'` 的 tool 結果。 */
  content: string | null | unknown[]
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface PruneStats {
  changed: boolean
  softTrimmed: number
  hardCleared: number
  savedChars: number
}

const HARD_CLEAR_MARKER = '〔工具結果已由 pruning 清除'
const SOFT_TRIM_MARKER = '…〔pruning 截斷 '

/**
 * 三層截斷。回傳新陣列;未動到的訊息保持同一參考。
 * 冪等:已截斷/已清除的內容不會被重複處理。
 */
export function pruneToolResults<T extends PrunableMessage>(
  messages: T[],
  cfg: PruningConfig = DEFAULT_PRUNING_CONFIG,
): { messages: T[]; stats: PruneStats } {
  const stats: PruneStats = { changed: false, softTrimmed: 0, hardCleared: 0, savedChars: 0 }
  if (!cfg.enabled) return { messages, stats }

  // 每則 tool 訊息屬於其前方最近一次 assistant.tool_calls 的輪次
  const totalRounds = messages.filter((m) => m.role === 'assistant' && m.tool_calls?.length).length
  if (totalRounds === 0) return { messages, stats }

  let roundIdx = 0
  const next = messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      roundIdx += 1
      return m
    }
    if (m.role !== 'tool' || typeof m.content !== 'string') return m

    // age 0 = 最新一輪
    const age = totalRounds - roundIdx
    if (age < cfg.keepLastNRounds) return m
    const content = m.content
    if (content.includes(HARD_CLEAR_MARKER) || content.includes(SOFT_TRIM_MARKER)) return m

    if (age >= cfg.hardClearAgeRounds) {
      const replaced = `${HARD_CLEAR_MARKER}（${age} 輪前，原 ${content.length} chars）— 需要此結果時請重新呼叫工具〕`
      if (replaced.length >= content.length) return m
      stats.changed = true
      stats.hardCleared += 1
      stats.savedChars += content.length - replaced.length
      return { ...m, content: replaced }
    }

    if (content.length > cfg.softTrimThresholdChars) {
      const head = content.slice(0, cfg.softTrimHeadChars)
      const tail = content.slice(-cfg.softTrimTailChars)
      const cut = content.length - head.length - tail.length
      const trimmed = `${head}\n${SOFT_TRIM_MARKER}${cut} chars（${age} 輪前）〕\n${tail}`
      if (trimmed.length >= content.length) return m
      stats.changed = true
      stats.softTrimmed += 1
      stats.savedChars += content.length - trimmed.length
      return { ...m, content: trimmed }
    }
    return m
  })

  return { messages: stats.changed ? next : messages, stats }
}
