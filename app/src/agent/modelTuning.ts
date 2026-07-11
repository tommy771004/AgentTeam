/**
 * Conservative tool-loop recommendations inferred from a model id.
 * Providers do not expose context-window metadata consistently, so explicit
 * size suffixes win; unknown models retain the current baseline.
 */
export type ToolTuning = {
  contextWindow: number | null
  toolSearchThreshold: number
  maxToolPayloadKb: number
  maxToolRounds: number
  label: string
}

const BASELINE: ToolTuning = {
  contextWindow: null,
  toolSearchThreshold: 24,
  maxToolPayloadKb: 50,
  maxToolRounds: 4,
  label: '未知 context，採安全基準值',
}

export function inferContextWindow(model: string): number | null {
  const id = model.toLowerCase()
  const million = id.match(/(?:^|[-_])([12])m(?:$|[-_])/)
  if (million) return Number(million[1]) * 1_000_000
  const k = id.match(/(?:^|[-_])(8|16|32|64|128|200|256)k(?:$|[-_])/)
  return k ? Number(k[1]) * 1_000 : null
}

export function recommendToolTuning(model: string): ToolTuning {
  const contextWindow = inferContextWindow(model)
  if (!contextWindow) return BASELINE
  if (contextWindow >= 200_000) {
    return { contextWindow, toolSearchThreshold: 48, maxToolPayloadKb: 96, maxToolRounds: 8, label: `${contextWindow / 1000}K context：較寬的工具與證據預算` }
  }
  if (contextWindow >= 128_000) {
    return { contextWindow, toolSearchThreshold: 36, maxToolPayloadKb: 64, maxToolRounds: 6, label: `${contextWindow / 1000}K context：平衡預算` }
  }
  if (contextWindow < 32_000) {
    return { contextWindow, toolSearchThreshold: 12, maxToolPayloadKb: 24, maxToolRounds: 3, label: `${contextWindow / 1000}K context：保守節省 context` }
  }
  return { ...BASELINE, contextWindow, label: `${contextWindow / 1000}K context：採安全基準值` }
}
