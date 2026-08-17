/**
 * Agent Prompt Schema parser — implements 03_Agent_Prompt_Schema
 * Converts raw user input into a structured Loop Configuration.
 */

import type { LoopConfiguration, LoopType, NextState, ParseResult, ExecutionStep } from './types.ts'
import { detectAutomationSuggestion } from './automationSuggestion.ts'
export type {
  AutomationScheduleHint,
  AutomationSuggestion,
  AutomationSuggestionKind,
} from './automationSuggestion.ts'
export {
  detectAutomationSuggestion,
  formatAutomationSuggestion,
} from './automationSuggestion.ts'

const GOAL_KEYWORDS = [
  'find',
  'analyze',
  'research',
  'compare',
  'synthesize',
  'generate',
  'build',
  'create',
  'investigate',
  'extract',
  'until',
  'complete',
  'report',
  'summary',
  '找',
  '分析',
  '研究',
  '比較',
  '整理',
  '彙整',
  '產生',
  '建立',
  '報告',
  '摘要',
  '調查',
  '重構',
  '實作',
  '實現',
  '開發',
  '修復',
  '排查',
]

const DOD_COUNT_RE = /(\d+)\s*(?:個|項|款|種|items?|tools?|options?|examples?|篇|筆)/i

const TIME_KEYWORDS = [
  'daily',
  'every day',
  'cron',
  'schedule',
  'at ',
  'every hour',
  'weekly',
  '定時',
  '每日',
  '每週',
  '每小時',
  '排程',
]

const PROACTIVE_KEYWORDS = [
  'when',
  'if email',
  'webhook',
  'on event',
  'monitor',
  'trigger when',
  '當',
  '如果',
  '若',
  '一旦',
  '每當',
  '事件',
]

/** Multi-clause / pipeline signals → prefer Goal-based even if short. */
const COMPLEX_MARKERS =
  /以及|並且|然後|再來|接著|之後|比較|分析|研究|調查|重構|實作|實現|修復|排查|compare|then\b|and then|step by step|逐步/i

/**
 * Short conversational turn — one shot answer / single action, not a multi-step goal.
 * Used for auto loop classification (Chat-lite → Turn-based).
 */
export function isChatLiteObjective(input: string): boolean {
  const text = input.trim()
  if (!text) return false
  if (text.length > 100) return false
  if (DOD_COUNT_RE.test(text)) return false
  if (COMPLEX_MARKERS.test(text)) return false
  const lower = text.toLowerCase()
  if (TIME_KEYWORDS.some((k) => lower.includes(k) || text.includes(k))) return false
  if (PROACTIVE_KEYWORDS.some((k) => lower.includes(k) || text.includes(k))) return false
  if (GOAL_KEYWORDS.some((k) => lower.includes(k) || text.includes(k))) return false
  // multi-line plans
  if (text.split(/\n/).filter((line) => line.trim()).length >= 3) return false
  return true
}

export function classifyLoopType(input: string): LoopType {
  const text = input.trim()
  const lower = text.toLowerCase()

  // Conversational automation intent is advisory only.  Time-based and
  // Proactive remain valid for explicit trigger adapters, never for text auto
  // classification.
  if (detectAutomationSuggestion(text)) return 'Goal-based'

  // Chat-lite first: short Q&A must not become a Goal pipeline
  if (isChatLiteObjective(text)) return 'Turn-based'

  if (
    GOAL_KEYWORDS.some((k) => lower.includes(k) || text.includes(k)) ||
    COMPLEX_MARKERS.test(text) ||
    text.length > 80
  ) {
    return 'Goal-based'
  }

  // Short imperative → turn-based
  return 'Turn-based'
}

function deriveSteps(input: string, loopType: LoopType): string[] {
  if (loopType === 'Turn-based') {
    // Chat-lite / Turn: single action (1 Input = 1 Action)
    return ['執行並回覆使用者']
  }

  if (loopType === 'Time-based') {
    return [
      '驗證排程觸發條件',
      '從來源擷取資料',
      '處理與轉換 payload',
      '投遞到目標端點',
    ]
  }

  if (loopType === 'Proactive') {
    return [
      '比對事件布林條件',
      '擷取事件參數',
      '執行綁定動作',
      '確認投遞完成',
    ]
  }

  // Goal-based: specialize from keywords (EN + ZH)
  if (/search|find|tools|software|搜尋|找.*工具|軟體|產品/i.test(input)) {
    return [
      '搜尋目標領域候選',
      '擷取功能與價格等欄位',
      '比較候選項目',
      '整理成 Markdown 表格',
      '對照 Definition of Done 驗收',
    ]
  }

  if (/log|security|anomal|日誌|資安|異常|漏洞/i.test(input)) {
    return [
      '取得相關日誌或訊號',
      '過濾噪音',
      '比對異常模式',
      '產生報告',
      '對照 Definition of Done 驗收',
    ]
  }

  if (/price|market|competitor|價格|市場|競品|競爭/i.test(input)) {
    return [
      '界定市場與競品範圍',
      '蒐集定價與功能資料',
      '抽取可比較維度',
      '合成洞察與建議',
      '對照 Definition of Done 驗收',
    ]
  }

  if (/重構|refactor|改寫|遷移|migrate/i.test(input)) {
    return [
      '定位現況與影響範圍',
      '擬定重構步驟',
      '實作變更',
      '驗證行為與回歸',
      '對照 Definition of Done 驗收',
    ]
  }

  if (/修|fix|bug|錯誤|壞掉|失敗/i.test(input)) {
    return [
      '重現問題並收集證據',
      '定位根因',
      '實作修復',
      '驗證修復與邊界條件',
      '對照 Definition of Done 驗收',
    ]
  }

  if (/寫|實作|實現|開發|build|implement|create|新增功能/i.test(input)) {
    return [
      '釐清需求與驗收條件',
      '設計實作方案',
      '實作核心變更',
      '補測試或手動驗證',
      '對照 Definition of Done 驗收',
    ]
  }

  if (/比較|對照|compare|vs\b/i.test(input)) {
    return [
      '列出比較對象',
      '蒐集各對象關鍵屬性',
      '製表比較',
      '給出結論與建議',
      '對照 Definition of Done 驗收',
    ]
  }

  // Generic goal pipeline (Traditional Chinese — not English canned labels)
  return [
    '釐清目標與成功條件',
    '蒐集必要資訊與證據',
    '分析與綜合發現',
    '產出可交付結果',
    '對照 Definition of Done 驗收',
  ]
}

function deriveDoD(input: string, loopType: LoopType, stepCount: number): string {
  if (loopType === 'Turn-based') return '已完成單一動作並回覆使用者可見結果'
  if (loopType === 'Time-based') return '資料成功擷取並投遞到目標端點'
  if (loopType === 'Proactive') return '依事件參數成功執行綁定動作'

  // Goal-based heuristics
  const threeItems = input.match(DOD_COUNT_RE)
  if (threeItems) {
    return `輸出含恰好 ${threeItems[1]} 個獨立項目，且必要欄位已填寫`
  }
  if (/table|compare|表格|比較/i.test(input)) {
    return 'Markdown 比較表欄位齊全（缺資料標 N/A）'
  }
  if (/修|fix|bug|錯誤/i.test(input)) {
    return '問題已修復且有驗證證據（測試或重現步驟結果）'
  }
  return `全部 ${stepCount} 個執行步驟完成，且產出可直接使用並信心 ≥ 0.80`
}

function maxIterationsFor(loopType: LoopType): number {
  switch (loopType) {
    case 'Goal-based':
      return 5
    case 'Turn-based':
      return 1
    case 'Time-based':
      return 1
    case 'Proactive':
      return 1
  }
}

/**
 * Parse raw user request into Loop Configuration (schema from 03_Agent_Prompt_Schema).
 * @param forceLoopType When set (UI / automation), re-derive steps & DoD for that mode
 *                      instead of only overwriting the type label.
 */
export function parseUserRequest(
  rawInput: string,
  forceLoopType?: LoopType,
): ParseResult {
  const objective = rawInput.trim()
  if (!objective) {
    throw new Error('Empty request: provide an objective or command.')
  }

  const loopType = forceLoopType || classifyLoopType(objective)
  const sequence = deriveSteps(objective, loopType)
  let maxIterations = maxIterationsFor(loopType)
  // Goal default iterations are often overridden by settings in engine
  if ((forceLoopType || loopType) === 'Goal-based') {
    maxIterations = Math.max(maxIterations, 5)
  }

  return buildParseResult(
    objective,
    loopType,
    sequence,
    deriveDoD(objective, loopType, sequence.length),
    maxIterations,
  )
}

/** Shared assembly for heuristic and LLM parsers (03 schema → ParseResult). */
export function buildParseResult(
  objective: string,
  loopType: LoopType,
  sequence: string[],
  definitionOfDone: string,
  maxIterations: number,
  nextState?: NextState,
): ParseResult {
  const config: LoopConfiguration = {
    loopType,
    trigger:
      loopType === 'Turn-based'
        ? 'Received user input (synchronous)'
        : loopType === 'Goal-based'
          ? 'Complex objective assigned'
          : loopType === 'Time-based'
            ? 'System clock reaches predefined timestamp'
            : 'Event payload matches boolean criteria',
    executionSequence: sequence,
    definitionOfDone,
    maxIterations,
    fallbackProtocol:
      loopType === 'Goal-based'
        ? 'Halt and route to human-in-the-loop queue after max iterations'
        : 'Log error and halt',
    nextState: nextState || (loopType === 'Turn-based' ? 'Await User Input' : 'Halt'),
  }

  const steps: ExecutionStep[] = sequence.map((action, i) => ({
    step: i + 1,
    action: action.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_一-鿿]/g, ''),
    description: action,
    status: 'PENDING' as const,
  }))

  return { config, objective, steps }
}

export type PlanBubbleMode = 'auto' | 'force'

export interface PlanBubbleOptions {
  mode?: PlanBubbleMode
  /** Lifecycle source kind, e.g. schedule / webhook / composer. */
  sourceKind?: string
  /** Explicit source text supplied by an integration or restored run. */
  triggerSource?: string
  /** Human-readable label supplied by the entry adapter. */
  sourceLabel?: string
  /** Explicit caller reason takes precedence over the derived reason. */
  classificationReason?: string
  loopType?: LoopType
  continueGoal?: boolean
}

export interface PlanBubbleMetadata {
  mode: PlanBubbleMode
  modeLabel: '自動分類' | '手動指定'
  triggerSource: string
  classificationReason: string
}

const PLAN_TRIGGER_SOURCE_LABELS: Readonly<Record<string, string>> = {
  composer: '對話文字',
  slash: 'Slash command',
  retry: '手動重試',
  schedule: 'ScheduledJob trigger',
  webhook: 'Webhook event payload',
  event: 'Event matcher',
  telegram: 'Telegram inbound',
  delegate: 'Delegate task',
  'queue-drain': 'Queue drain',
}

const AUTOMATION_TRIGGER_KINDS = new Set([
  'schedule',
  'webhook',
  'event',
  'telegram',
  'delegate',
  'queue-drain',
])

function sourceDescriptor(sourceKind?: string): string {
  return sourceKind ? PLAN_TRIGGER_SOURCE_LABELS[sourceKind] || sourceKind : ''
}

function resolvePlanTriggerSource(opts: PlanBubbleOptions): string {
  const explicit = opts.triggerSource?.trim()
  if (explicit) return explicit

  const descriptor = sourceDescriptor(opts.sourceKind)
  const label = opts.sourceLabel?.trim()
  if (label) {
    if (!descriptor || label.includes(descriptor)) return label
    return `${descriptor} · ${label}`
  }
  return descriptor || '對話文字'
}

function resolvePlanClassificationReason(
  opts: PlanBubbleOptions,
): string {
  const explicit = opts.classificationReason?.trim()
  if (explicit) return explicit

  if (opts.continueGoal) {
    return '沿用既有 Goal-based DoD，依使用者指示繼續／補齊缺口'
  }

  const loopLabel = opts.loopType || 'Turn-based / Goal-based'
  if (opts.mode !== 'force') {
    if (!opts.sourceKind || opts.sourceKind === 'composer' || opts.sourceKind === 'slash') {
      return '由對話自動分類（僅允許 Turn-based / Goal-based）'
    }
    return `由 ${sourceDescriptor(opts.sourceKind)} 自動分類（僅允許 Turn-based / Goal-based）`
  }

  if (opts.sourceKind === 'schedule') {
    return `由已驗證 ScheduledJob trigger 明確指定 ${loopLabel}`
  }
  if (opts.sourceKind === 'webhook') {
    return `由已驗證 Webhook matcher evidence 明確指定 ${loopLabel}`
  }
  if (opts.sourceKind === 'event') {
    return `由已驗證 event matcher evidence 明確指定 ${loopLabel}`
  }
  if (opts.sourceKind === 'telegram') {
    return `由 Telegram inbound adapter 明確指定 ${loopLabel}`
  }
  if (opts.sourceKind === 'delegate') {
    return `由 Delegate task adapter 明確指定 ${loopLabel}`
  }
  if (opts.sourceKind === 'queue-drain') {
    return `由佇列補跑保留的來源明確指定 ${loopLabel}`
  }
  if (AUTOMATION_TRIGGER_KINDS.has(opts.sourceKind || '')) {
    return `由已驗證自動化 trigger 明確指定 ${loopLabel}`
  }
  return `由使用者手動指定 ${loopLabel}`
}

/** Resolve source and classification copy for every plan bubble entry point. */
export function resolvePlanBubbleMetadata(
  opts: PlanBubbleOptions = {},
): PlanBubbleMetadata {
  const mode: PlanBubbleMode = opts.mode === 'force' ? 'force' : 'auto'
  return {
    mode,
    modeLabel: mode === 'force' ? '手動指定' : '自動分類',
    triggerSource: resolvePlanTriggerSource(opts),
    classificationReason: resolvePlanClassificationReason({ ...opts, mode }),
  }
}

/** Compact plan bubble for chat UI after parse. */
export function formatPlanBubble(
  config: LoopConfiguration,
  opts?: PlanBubbleOptions,
): string {
  const meta = resolvePlanBubbleMetadata({
    ...opts,
    loopType: opts?.loopType || config.loopType,
  })
  const steps = config.executionSequence
    .slice(0, 7)
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n')
  return [
    `📋 執行計畫（${meta.modeLabel} · ${config.loopType}）`,
    `Trigger source：${meta.triggerSource}`,
    `分類原因：${meta.classificationReason}`,
    `DoD：${config.definitionOfDone.slice(0, 160)}`,
    `步驟 ${config.executionSequence.length} · 最多 ${config.maxIterations} 輪`,
    steps,
  ].filter(Boolean).join('\n')
}

/** Render loop config as the markdown schema from the docs. */
export function formatConfigMarkdown(config: LoopConfiguration, objective: string): string {
  return `### [Loop Configuration]
- **Loop_Type**: ${config.loopType}
- **Trigger**: ${config.trigger}
- **Objective**: ${objective}

### [Execution Sequence]
${config.executionSequence.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### [Validation & Constraints]
- **Definition_of_Done (DoD)**: ${config.definitionOfDone}
- **Max_Iterations**: ${config.maxIterations}
- **Fallback_Protocol**: ${config.fallbackProtocol}

### [Post-Execution]
- **Next_State**: ${config.nextState}`
}
