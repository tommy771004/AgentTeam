export type PiHostReleaseEvidence = {
  protocol: boolean
  utilityProcess: boolean
  sessions: boolean
  extensions: boolean
  protocolVersion: number
  capabilities: string[]
  checkedAt: string
}

export function isCompletePiHostReleaseEvidence(value: unknown): value is PiHostReleaseEvidence {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Partial<PiHostReleaseEvidence>
  return evidence.protocol === true
    && evidence.utilityProcess === true
    && evidence.sessions === true
    && evidence.extensions === true
    && evidence.protocolVersion === 1
    && Array.isArray(evidence.capabilities)
    && evidence.capabilities.includes('sessions')
    && evidence.capabilities.includes('resources')
    && typeof evidence.checkedAt === 'string'
}
