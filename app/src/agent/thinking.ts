/**
 * 對話層：模型 + 推理強度（UI 對齊 Cursor 式下拉）
 */

import type { RuntimeOverrides } from './types.ts'

/**
 * 推理程度（對應附圖：快思 / 中 / 高 / 極高 / 超高）
 */
export type ThinkingDepth = 'fast' | 'standard' | 'deep' | 'max' | 'ultra'

export type SpeedMode = 'fast' | 'standard' | 'careful'

export type PiThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ThinkingDepthDef {
  id: ThinkingDepth
  /** 選單顯示名 */
  label: string
  shortLabel: string
  description: string
  maxIterations: number
  maxToolRounds: number
  systemHint: string
  /** 提示額度消耗 */
  costNote?: string
}

export const THINKING_DEPTHS: ThinkingDepthDef[] = [
  {
    id: 'fast',
    label: '快思',
    shortLabel: '快思',
    description: '最快回應，少步驟',
    maxIterations: 2,
    maxToolRounds: 2,
    systemHint: '推理程度：快思。優先直接回答，少用工具，回覆精簡。',
  },
  {
    id: 'standard',
    label: '中',
    shortLabel: '中',
    description: '平衡速度與品質',
    maxIterations: 4,
    maxToolRounds: 3,
    systemHint: '推理程度：中。適度規劃與工具，輸出清楚可執行。',
  },
  {
    id: 'deep',
    label: '高',
    shortLabel: '高',
    description: '較深推理與驗證',
    maxIterations: 6,
    maxToolRounds: 5,
    systemHint: '推理程度：高。多步推理、必要時工具蒐證，標註不確定性。',
  },
  {
    id: 'max',
    label: '極高',
    shortLabel: '極高',
    description: '長鏈推理與交叉檢查',
    maxIterations: 10,
    maxToolRounds: 7,
    systemHint: '推理程度：極高。徹底分析、多路徑驗證、完整證據鏈。',
    costNote: '較快消耗使用額度',
  },
  {
    id: 'ultra',
    label: '超高',
    shortLabel: '超高',
    description: '最大推理預算',
    maxIterations: 14,
    maxToolRounds: 10,
    systemHint: '推理程度：超高。最長推理預算，可委派子任務，勿草率收斂。',
    costNote: '更快消耗使用額度',
  },
]

export const SPEED_MODES: Array<{
  id: SpeedMode
  label: string
  description: string
}> = [
  { id: 'fast', label: '快速', description: '較低延遲，略減探索' },
  { id: 'standard', label: '標準', description: '預設平衡' },
  { id: 'careful', label: '謹慎', description: '更多檢查步驟' },
]

export function getThinkingDepth(id: ThinkingDepth | string | undefined): ThinkingDepthDef {
  return THINKING_DEPTHS.find((d) => d.id === id) || THINKING_DEPTHS[2] // 預設「高」
}

export function getSpeedMode(id: SpeedMode | string | undefined) {
  return SPEED_MODES.find((s) => s.id === id) || SPEED_MODES[1]
}

/** Translate the Composer's depth vocabulary to Pi Core's task profile. */
export function piThinkingLevelForDepth(depth?: ThinkingDepth): PiThinkingLevel | undefined {
  if (!depth) return undefined
  return {
    fast: 'low',
    standard: 'medium',
    deep: 'high',
    max: 'xhigh',
    ultra: 'max',
  }[depth] as PiThinkingLevel
}

export function conversationRuntimeOverrides(opts: {
  model?: string
  depth?: ThinkingDepth
  speed?: SpeedMode
  extra?: Partial<RuntimeOverrides>
}): RuntimeOverrides {
  const depth = getThinkingDepth(opts.depth || 'deep')
  const speed = getSpeedMode(opts.speed || 'standard')
  let maxIterations = depth.maxIterations
  let maxToolRounds = depth.maxToolRounds
  if (speed.id === 'fast') {
    maxIterations = Math.max(1, maxIterations - 1)
    maxToolRounds = Math.max(1, maxToolRounds - 1)
  } else if (speed.id === 'careful') {
    maxIterations += 1
    maxToolRounds += 1
  }
  return {
    model: opts.model?.trim() || undefined,
    maxIterations,
    maxToolRounds,
    extraSystemContext: [
      '## 對話設定',
      opts.model ? `模型：${opts.model}` : '',
      depth.systemHint,
      `速度偏好：${speed.label} — ${speed.description}`,
    ]
      .filter(Boolean)
      .join('\n'),
    ...opts.extra,
  }
}
