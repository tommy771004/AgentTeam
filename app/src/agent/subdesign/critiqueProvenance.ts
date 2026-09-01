import { SUBDESIGN_SCORE_GATE_MAP } from './critique.ts'
import type { SubDesignCritique } from './types.ts'

export type SubDesignCritiqueScoreKey = keyof Pick<
  SubDesignCritique,
  'briefCoverage' | 'brandConformance' | 'accessibility' | 'implementationReadiness'
>

/** Return only Host-attested gate evidence that can back the selected score. */
export function gateProvenanceFor(critique: SubDesignCritique, scoreKey: SubDesignCritiqueScoreKey) {
  const allowed = new Set(SUBDESIGN_SCORE_GATE_MAP[scoreKey])
  return critique.evidence.filter(
    (item) => item.kind === 'gate' && item.gateId && allowed.has(item.gateId),
  )
}
