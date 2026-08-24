/**
 * 階段 → AgentThinking 變體對應。獨立於元件檔,
 * 讓 AgentThinking.tsx 維持 fast-refresh 相容的純元件輸出。
 */
import type { AgentThinkingVariant } from './AgentThinking'

/** run lifecycle 階段 → 變體:HITL(等待使用者/核准)不由本元件呈現。 */
const PHASE_VARIANTS: Record<string, AgentThinkingVariant> = {
  starting: 'spin',
  parsing: 'spin',
  thinking: 'wave',
  planning: 'stars',
  executing: 'infinity',
  responding: 'spin',
  finalizing: 'stars',
  cancel_requested: 'spin',
}

export function thinkingVariantForPhase(phase?: string): AgentThinkingVariant {
  return PHASE_VARIANTS[phase || ''] || 'wave'
}

/** SubDesign 階段 → 變體:build 是長工(infinity)、critique 是逐步檢視(wave)、其餘準備動作(spin)。 */
export function thinkingVariantForStage(stage?: string): AgentThinkingVariant {
  if (stage === 'critique') return 'wave'
  if (stage === 'build') return 'infinity'
  return 'spin'
}
